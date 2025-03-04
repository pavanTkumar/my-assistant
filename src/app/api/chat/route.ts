import { NextResponse } from 'next/server';
import { processConversation } from '@/lib/langgraph';

export async function POST(request: Request) {
  try {
    const { messages } = await request.json();
    
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      );
    }
    
    // Validate the format of messages
    for (const message of messages) {
      if (
        typeof message !== 'object' ||
        !message.role ||
        !message.content ||
        typeof message.role !== 'string' ||
        typeof message.content !== 'string'
      ) {
        return NextResponse.json(
          { error: 'Invalid message format. Each message must have role and content properties.' },
          { status: 400 }
        );
      }
    }
    
    // Process the conversation using LangGraph
    const result = await processConversation(messages);
    
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process chat request' },
      { status: 500 }
    );
  }
}