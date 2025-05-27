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

export { parseMarkdownTranscript, createChunks, formatChunkForClaude };
export type { TranscriptSegment, Chunk };