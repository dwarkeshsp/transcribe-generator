import { NextRequest, NextResponse } from 'next/server';
import { SHARED_ENHANCEMENT_PROMPT } from '../../lib/prompts';

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
    const { chunk } = await request.json();
    
    if (!chunk) {
      return NextResponse.json(
        { error: 'No chunk provided' },
        { status: 400 }
      );
    }
    
    const enhanced = await enhanceChunkWithClaude(chunk);
    
    return NextResponse.json({
      enhanced_chunk: enhanced
    });
    
  } catch (error) {
    console.error('Enhancement error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}