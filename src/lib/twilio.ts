import twilio from 'twilio';

// Initialize Twilio client
export const getTwilioClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured');
  }
  
  return twilio(accountSid, authToken);
};

// Send a WhatsApp message
export async function sendWhatsAppMessage(to: string, body: string) {
  try {
    const client = getTwilioClient();
    const twilioWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER;
    
    if (!twilioWhatsAppNumber) {
      throw new Error('Twilio WhatsApp number not configured');
    }
    
    // Format the numbers for WhatsApp
    const formattedFrom = `whatsapp:${twilioWhatsAppNumber}`;
    const formattedTo = `whatsapp:${to}`;
    
    const message = await client.messages.create({
      body,
      from: formattedFrom,
      to: formattedTo,
    });
    
    return {
      success: true,
      messageId: message.sid,
      status: message.status,
    };
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    throw error;
  }
}

// Check if a phone number is valid for WhatsApp
export function isValidPhoneNumber(phoneNumber: string): boolean {
  // Simple regex for international phone number format
  // This is a basic validation and might need to be enhanced for your specific requirements
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  return phoneRegex.test(phoneNumber);
}

// Format a message for WhatsApp
export function formatWhatsAppMessage(
  name: string,
  email: string,
  message: string,
  isUrgent: boolean = false
): string {
  return `
*New Message from Virtual Assistant*
${isUrgent ? '❗ *URGENT* ❗' : ''}

*From:* ${name}
*Email:* ${email}
*Message:*
${message}

_Sent via Pavan Tejavath's Virtual Assistant_
  `.trim();
}