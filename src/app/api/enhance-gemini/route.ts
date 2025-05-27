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
  
  console.log(`Parsing transcript with ${lines.length} lines`);
  console.log('First few lines:', lines.slice(0, 5));
  
  let currentSpeaker = '';
  let currentTimestamp = '';
  let currentText = '';
  
  for (const line of lines) {
    const cleanLine = line.trim();
    // Match speaker and timestamp pattern: A 0:00:00 or SPEAKER A 0:00:00
    const speakerMatch = cleanLine.match(/^([A-Z\s]*[A-Z])\s+(\d+:\d+:\d+)$/);
    
    if (speakerMatch) {
      console.log('Found speaker match:', speakerMatch[1], speakerMatch[2]);
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
  
  console.log(`Parsed ${segments.length} segments`);
  if (segments.length > 0) {
    console.log('First segment:', segments[0]);
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
    const formData = await request.formData();
    const transcript = formData.get('transcript') as string;
    const audioFile = formData.get('audioFile') as File;
    
    if (!transcript || !audioFile) {
      return NextResponse.json(
        { error: 'Both transcript and audio file are required' },
        { status: 400 }
      );
    }
    
    console.log(`Processing audio file: ${audioFile.name}, size: ${audioFile.size} bytes, type: ${audioFile.type}`);
    console.log(`Gemini API Key configured: ${!!process.env.GEMINI_API_KEY}`);
    console.log(`Transcript preview: ${transcript.substring(0, 200)}...`);
    
    // Convert audio file to buffer
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const mimeType = audioFile.type || 'audio/mpeg';
    console.log(`Buffer size: ${audioBuffer.length}, MIME type: ${mimeType}`);
    
    // Parse the markdown transcript into segments
    const segments = parseMarkdownTranscript(transcript);
    console.log(`Parsed ${segments.length} segments from transcript`);
    
    if (segments.length === 0) {
      console.error('No segments parsed from transcript');
      return NextResponse.json(
        { error: 'Could not parse transcript segments' },
        { status: 400 }
      );
    }
    
    // Create chunks based on token limits
    const chunks = createChunks(segments, 2000);
    console.log(`Created ${chunks.length} chunks from ${segments.length} segments`);
    
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not found in environment');
      return NextResponse.json(
        { error: 'Gemini API key not configured' },
        { status: 500 }
      );
    }
    
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // Check if file is small enough for inline data (< 20MB)
    const audioSizeMB = audioBuffer.length / (1024 * 1024);
    console.log(`Audio file size: ${audioSizeMB.toFixed(2)} MB`);
    
    // Upload audio file once if needed
    let uploadedFile = null;
    let base64Audio = null;
    
    if (audioSizeMB < 20) {
      console.log('Using inline data approach');
      base64Audio = audioBuffer.toString('base64');
    } else {
      console.log('Using file upload approach');
      const audioBlob = new Blob([audioBuffer], { type: mimeType });
      
      uploadedFile = await ai.files.upload({
        file: audioBlob,
        config: { mimeType: mimeType },
      });
      
      console.log(`File uploaded: ${uploadedFile.uri}`);
    }
    
    // Process all chunks
    const enhancedChunks: string[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const formattedChunk = formatChunkForGemini(chunk);
      
      try {
        console.log(`Processing chunk ${i + 1}/${chunks.length}`);
        
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
                mimeType: mimeType,
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
        console.log(`Chunk ${i + 1} completed`);
        
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
    
    // Combine enhanced chunks
    const enhancedTranscript = enhancedChunks.join('\n\n');
    
    return NextResponse.json({
      enhanced_transcript: enhancedTranscript,
      chunks_processed: chunks.length,
      total_segments: segments.length
    });
    
  } catch (error) {
    console.error('General error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}