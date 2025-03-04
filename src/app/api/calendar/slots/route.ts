import { NextResponse } from 'next/server';
import { getAvailableSlots } from '@/lib/googleCalendar';

export async function GET(request: Request) {
  try {
    // Extract date from query params
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    
    if (!date) {
      return NextResponse.json(
        { error: 'Date parameter is required' },
        { status: 400 }
      );
    }
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }
    
    // Get available slots
    const availableSlots = await getAvailableSlots(date);
    
    return NextResponse.json({ date, availableSlots });
  } catch (error: any) {
    console.error('Error in calendar/slots API:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch available slots' },
      { status: 500 }
    );
  }
}