import { NextResponse } from 'next/server';
import { sendWhatsAppMessage, isValidPhoneNumber, formatWhatsAppMessage } from '@/lib/twilio';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, message, urgent = false } = body;
    
    // Validate required fields
    if (!name || !email || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: name, email, and message are required' },
        { status: 400 }
      );
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }
    
    // Format the message
    const formattedMessage = formatWhatsAppMessage(name, email, message, urgent);
    
    // Get owner's WhatsApp number from environment variables
    const ownerPhoneNumber = process.env.OWNER_PHONE_NUMBER;
    
    if (!ownerPhoneNumber || !isValidPhoneNumber(ownerPhoneNumber)) {
      return NextResponse.json(
        { error: 'Owner phone number is not configured or is invalid' },
        { status: 500 }
      );
    }
    
    // Send the WhatsApp message
    const result = await sendWhatsAppMessage(ownerPhoneNumber, formattedMessage);
    
    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      status: result.status,
    });
  } catch (error: any) {
    console.error('Error in message API:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to send message' },
      { status: 500 }
    );
  }
}