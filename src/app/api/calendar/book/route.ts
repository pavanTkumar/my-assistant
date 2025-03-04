import { NextResponse } from 'next/server';
import { bookAppointment } from '@/lib/googleCalendar';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, date, time, duration, purpose } = body;
    
    // Validate required fields
    if (!name || !email || !date || !time) {
      return NextResponse.json(
        { error: 'Missing required fields: name, email, date, and time are required' },
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
    
    // Book the appointment
    const result = await bookAppointment(
      name,
      email,
      date,
      time,
      duration || 30,
      purpose || 'Meeting with Pavan Tejavath'
    );
    
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error in calendar/book API:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to book appointment' },
      { status: 500 }
    );
  }
}