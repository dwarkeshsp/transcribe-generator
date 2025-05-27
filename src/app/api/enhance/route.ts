import { NextRequest, NextResponse } from 'next/server';
import { SHARED_ENHANCEMENT_PROMPT } from '../../lib/prompts';

interface TranscriptSegment {
  speaker: string;
  timestamp: string;
  text: string;
  tokenCount: number;
}

interface Chunk {
  segments: TranscriptSegment[];
  totalTokens: number;
  startTime: string;
  endTime: string;
}

function parseMarkdownTranscript(markdown: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = markdown.split(/\r?\n/).filter(line => line.trim());
  
  let currentSpeaker = '';
  let currentTimestamp = '';
  let currentText = '';
  
  for (const line of lines) {
    const cleanLine = line.trim();
    // Match speaker and timestamp pattern: A 0:00:00 or SPEAKER A 0:00:00
    const speakerMatch = cleanLine.match(/^([A-Z\s]*[A-Z])\s+(\d+:\d+:\d+)$/);
    
    if (speakerMatch) {
      // Save previous segment if exists
      if (currentSpeaker && currentText.trim()) {
        segments.push({
          speaker: currentSpeaker,
          timestamp: currentTimestamp,
          text: currentText.trim(),
          tokenCount: estimateTokens(currentText.trim())
        });
      }
      
      // Start new segment
      currentSpeaker = speakerMatch[1];
      currentTimestamp = speakerMatch[2];
      currentText = '';
    } else if (cleanLine && currentSpeaker) {
      // Add text to current segment
      currentText += cleanLine + '\n';
    }
  }
  
  // Add final segment
  if (currentSpeaker && currentText.trim()) {
    segments.push({
      speaker: currentSpeaker,
      timestamp: currentTimestamp,
      text: currentText.trim(),
      tokenCount: estimateTokens(currentText.trim())
    });
  }
  
  return segments;
}

function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token
  return Math.ceil(text.length / 4);
}

function createChunks(segments: TranscriptSegment[], maxTokens: number = 2000): Chunk[] {
  const chunks: Chunk[] = [];
  let currentChunk: TranscriptSegment[] = [];
  let currentTokens = 0;
  
  for (const segment of segments) {
    // If adding this segment would exceed the limit and we have segments
    if (currentTokens + segment.tokenCount > maxTokens && currentChunk.length > 0) {
      // Create chunk from current segments
      chunks.push({
        segments: [...currentChunk],
        totalTokens: currentTokens,
        startTime: currentChunk[0].timestamp,
        endTime: currentChunk[currentChunk.length - 1].timestamp
      });
      
      // Start new chunk
      currentChunk = [segment];
      currentTokens = segment.tokenCount;
    } else {
      // Add segment to current chunk
      currentChunk.push(segment);
      currentTokens += segment.tokenCount;
    }
  }
  
  // Add final chunk if it has segments
  if (currentChunk.length > 0) {
    chunks.push({
      segments: [...currentChunk],
      totalTokens: currentTokens,
      startTime: currentChunk[0].timestamp,
      endTime: currentChunk[currentChunk.length - 1].timestamp
    });
  }
  
  return chunks;
}

function formatChunkForClaude(chunk: Chunk): string {
  let formatted = '';
  
  for (const segment of chunk.segments) {
    formatted += `${segment.speaker} ${segment.timestamp}\n\n${segment.text}\n\n`;
  }
  
  return formatted.trim();
}

async function enhanceChunkWithClaude(chunk: string): Promise<string> {
  const claudeApiKey = process.env.CLAUDE_API_KEY;
  
  if (!claudeApiKey) {
    throw new Error('Claude API key not configured');
  }
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-20250514',
      max_tokens: 4000,
      system: SHARED_ENHANCEMENT_PROMPT,
      messages: [
        {
          role: 'user',
          content: chunk
        }
      ]
    })
  });
  
  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }
  
  const result = await response.json();
  return result.content[0].text;
}

export async function POST(request: NextRequest) {
  try {
    const { transcript } = await request.json();
    
    if (!transcript) {
      return NextResponse.json(
        { error: 'No transcript provided' },
        { status: 400 }
      );
    }
    
    // Parse the markdown transcript into segments
    const segments = parseMarkdownTranscript(transcript);
    
    if (segments.length === 0) {
      return NextResponse.json(
        { error: 'Could not parse transcript segments' },
        { status: 400 }
      );
    }
    
    // Create chunks based on token limits
    const chunks = createChunks(segments, 2000);
    
    // Create a readable stream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        // Send initial progress
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'progress',
          completed: 0,
          total: chunks.length,
          message: 'Starting Claude enhancement...'
        })}\n\n`));
        
        const enhancedChunks: string[] = [];
        
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const formattedChunk = formatChunkForClaude(chunk);
          
          try {
            // Send progress update
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'progress',
              completed: i,
              total: chunks.length,
              message: `Processing chunk ${i + 1}/${chunks.length} with Claude...`
            })}\n\n`));
            
            const enhanced = await enhanceChunkWithClaude(formattedChunk);
            enhancedChunks.push(enhanced);
          } catch (error) {
            console.error(`Error enhancing chunk ${i + 1}:`, error);
            // Fallback to original chunk if enhancement fails
            enhancedChunks.push(formattedChunk);
          }
          
          // Add delay between requests to respect API rate limits
          if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        // Send final result
        const enhancedTranscript = enhancedChunks.join('\n\n');
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'complete',
          enhanced_transcript: enhancedTranscript,
          chunks_processed: chunks.length,
          total_segments: segments.length
        })}\n\n`));
        
        controller.close();
      }
    });
    
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
    
  } catch (error) {
    console.error('Enhancement error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}