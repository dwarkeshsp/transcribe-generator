import { NextRequest, NextResponse } from 'next/server';

interface AssemblyAIResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text: string;
  utterances?: Array<{
    confidence: number;
    start: number;
    end: number;
    text: string;
    speaker: string;
  }>;
  error?: string;
}

function formatTimestamp(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatTranscriptToMarkdown(utterances: AssemblyAIResponse['utterances']): string {
  if (!utterances || utterances.length === 0) {
    return 'No transcript available.';
  }

  let markdown = '';
  let currentSpeaker = '';

  for (const utterance of utterances) {
    if (utterance.speaker !== currentSpeaker) {
      currentSpeaker = utterance.speaker;
      const timestamp = formatTimestamp(utterance.start);
      const speakerLabel = utterance.speaker.replace('speaker_', 'Speaker ').toUpperCase();
      markdown += `\n${speakerLabel} ${timestamp}\n\n`;
    }
    markdown += utterance.text + '\n\n';
  }

  return markdown.trim();
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ASSEMBLY_AI_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AssemblyAI API key not configured' },
        { status: 500 }
      );
    }

    const { upload_url } = await request.json();

    if (!upload_url) {
      return NextResponse.json(
        { error: 'No upload URL provided' },
        { status: 400 }
      );
    }

    // Step 1: Start transcription using the uploaded file URL
    const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'authorization': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: upload_url,
        speaker_labels: true,
        auto_highlights: false,
        disfluencies: false,
        filter_profanity: false,
        format_text: true,
        punctuate: true,
      }),
    });

    if (!transcriptResponse.ok) {
      throw new Error(`Transcription request failed: ${transcriptResponse.status}`);
    }

    const { id } = await transcriptResponse.json();

    // Step 2: Poll for completion
    let result: AssemblyAIResponse;
    let attempts = 0;
    const maxAttempts = 60; // 10 minutes max

    do {
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
      
      const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: {
          'authorization': apiKey,
        },
      });

      if (!pollResponse.ok) {
        throw new Error(`Polling failed: ${pollResponse.status}`);
      }

      result = await pollResponse.json();
      attempts++;

      if (attempts >= maxAttempts) {
        throw new Error('Transcription timeout');
      }
    } while (result.status === 'queued' || result.status === 'processing');

    if (result.status === 'error') {
      throw new Error(result.error || 'Transcription failed');
    }

    // Format the response to markdown
    const markdownTranscript = formatTranscriptToMarkdown(result.utterances);

    return NextResponse.json({
      transcript: markdownTranscript,
      raw_text: result.text,
    });

  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}