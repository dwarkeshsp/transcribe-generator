import { NextRequest, NextResponse } from 'next/server';

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
  const lines = markdown.split('\n').filter(line => line.trim());
  
  let currentSpeaker = '';
  let currentTimestamp = '';
  let currentText = '';
  
  for (const line of lines) {
    // Match speaker and timestamp pattern: **SPEAKER A** *0:00:00*
    const speakerMatch = line.match(/^\*\*([^*]+)\*\*\s*\*([^*]+)\*/);
    
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
    } else if (line.trim() && currentSpeaker) {
      // Add text to current segment
      currentText += line + '\n';
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

const SYSTEM_PROMPT = `You are an expert transcript editor. Your job is to transform spoken conversation into polished, essay-quality prose that reads like a published book or magazine article.

IMPORTANT: Respond ONLY with the enhanced transcript. Do not include any explanations, headers, or phrases like "Here is the transcript."

Your goal is to create text that reads as if the speakers sat down afterward and carefully wrote out their thoughts as a polished essay, rather than speaking extemporaneously. This should be the quality of writing you'd find in a high-end publication - clear, engaging, and professionally edited.

CRITICAL REQUIREMENTS:

1. AGGRESSIVE CLEANUP AND RESTRUCTURING:
- Remove ALL conversational artifacts (yeah, so, I mean, well, you know, like, etc.)
- Remove ALL filler words (um, uh, ah, etc.)
- Remove false starts, self-corrections, repetitions, and hesitations completely
- Break up rambling sentences into clear, well-structured paragraphs
- Combine related thoughts that were scattered across multiple sentences
- DO NOT change meaning or add new ideas - only clean and restructure existing content

2. ESSAY-QUALITY PARAGRAPH STRUCTURE:
- Create substantial paragraphs (3-6 sentences each) that develop complete thoughts
- Each paragraph should focus on a single main idea or topic
- Use topic sentences and logical flow between paragraphs
- Break up long monologues into multiple well-organized paragraphs
- When the same speaker continues, DON'T repeat their name - just start new paragraphs as needed

3. PROFESSIONAL WRITING STYLE:
- Use sophisticated sentence structure and transitions
- Employ proper punctuation, including semicolons, em dashes, and complex sentence structures
- Write with the clarity and elegance of a professional author
- Make it flow like written prose, not transcribed speech
- Ensure each paragraph reads like it was carefully crafted for publication

4. FORMATTING:
- Keep "SPEAKER X 00:00:00" format for new speakers only
- DO NOT change timestamps - keep them exactly as provided
- Add TWO line breaks between speaker/timestamp and content
- When continuing with same speaker in new paragraph, no attribution needed
- Use paragraph breaks liberally to organize ideas logically

Example transformation:

INPUT (raw speech):
SPEAKER A 00:00:00
Um, yeah, so like, I've been working on this new project at work, you know? And uh, what's really interesting is that, uh, we're seeing these amazing results with the new approach we're taking. Like, it's just, you know, it's really transforming how we do things. And then, I mean, the thing is, we've been able to, you know, streamline a lot of our processes and, uh, the efficiency gains have been incredible.

OUTPUT (essay quality):
SPEAKER A 00:00:00

I've been working on a new project at work that's yielding remarkable results through our innovative approach. The transformation in our operations has been genuinely significant, allowing us to streamline numerous processes while achieving incredible efficiency gains.

Transform the following transcript into polished, essay-quality prose:`;

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
      system: SYSTEM_PROMPT,
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
    
    // Enhance each chunk sequentially to avoid rate limits
    const enhancedChunks: string[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const formattedChunk = formatChunkForClaude(chunk);
      
      try {
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
    
    // Combine enhanced chunks
    const enhancedTranscript = enhancedChunks.join('\n\n');
    
    return NextResponse.json({
      enhanced_transcript: enhancedTranscript,
      chunks_processed: chunks.length,
      total_segments: segments.length
    });
    
  } catch (error) {
    console.error('Enhancement error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}