import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, createUserContent, createPartFromUri } from '@google/genai';
import { SHARED_ENHANCEMENT_PROMPT, GEMINI_AUDIO_ADDENDUM } from '../../lib/prompts';

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

function formatChunkForGemini(chunk: Chunk): string {
  let formatted = '';
  
  for (const segment of chunk.segments) {
    formatted += `${segment.speaker} ${segment.timestamp}\n\n${segment.text}\n\n`;
  }
  
  return formatted.trim();
}



export async function POST(request: NextRequest) {
  try {
    const { transcript, audioUrl, mimeType } = await request.json();
    
    if (!transcript || !audioUrl) {
      return NextResponse.json(
        { error: 'Both transcript and audio URL are required' },
        { status: 400 }
      );
    }
    
    // Download audio file from URL
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error('Failed to download audio file');
    }
    
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    const finalMimeType = mimeType || 'audio/mpeg';
    
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
    
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'Gemini API key not configured' },
        { status: 500 }
      );
    }
    
    // Create a readable stream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        try {
          // Send initial progress
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'progress',
            completed: 0,
            total: chunks.length,
            message: 'Starting Gemini enhancement...'
          })}\n\n`));
          
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          
          // Check if file is small enough for inline data (< 20MB)
          const audioSizeMB = audioBuffer.length / (1024 * 1024);
          
          // Upload audio file once if needed
          let uploadedFile = null;
          let base64Audio = null;
          
          if (audioSizeMB < 20) {
            base64Audio = audioBuffer.toString('base64');
          } else {
            const audioBlob = new Blob([audioBuffer], { type: finalMimeType });
            uploadedFile = await ai.files.upload({
              file: audioBlob,
              config: { mimeType: finalMimeType },
            });
          }
          
          // Process all chunks
          const enhancedChunks: string[] = [];
          
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const formattedChunk = formatChunkForGemini(chunk);
            
            try {
              // Send progress update
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'progress',
                completed: i,
                total: chunks.length,
                message: `Processing chunk ${i + 1}/${chunks.length} with Gemini...`
              })}\n\n`));
              
              const fullPrompt = `${SHARED_ENHANCEMENT_PROMPT}${GEMINI_AUDIO_ADDENDUM}

This is chunk ${i + 1} of ${chunks.length} from the full conversation. Focus on enhancing this specific portion while using the full audio for context:

${formattedChunk}`;
              
              let response;
              
              if (audioSizeMB < 20) {
                // Use inline data for smaller files
                const contents = [
                  { text: fullPrompt },
                  {
                    inlineData: {
                      mimeType: finalMimeType,
                      data: base64Audio!,
                    }
                  }
                ];
                
                response = await ai.models.generateContent({
                  model: 'gemini-2.5-pro-preview-05-06',
                  contents: contents
                });
              } else {
                // Use file upload for larger files
                response = await ai.models.generateContent({
                  model: 'gemini-2.5-pro-preview-05-06',
                  contents: createUserContent([
                    createPartFromUri(uploadedFile!.uri!, uploadedFile!.mimeType!),
                    fullPrompt
                  ])
                });
              }
              
              enhancedChunks.push(response.text || formattedChunk);
              
            } catch (error) {
              console.error(`Error enhancing chunk ${i + 1}:`, error);
              // Fallback to original chunk if enhancement fails
              enhancedChunks.push(formattedChunk);
            }
            
            // Add delay between requests to respect API rate limits
            if (i < chunks.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 2000));
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
          
        } catch (error) {
          console.error('General error:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Internal server error'
          })}\n\n`));
        }
        
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
    console.error('General error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}