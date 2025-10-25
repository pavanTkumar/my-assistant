async function testConversationalBooking() {
    let bookingState = null;
    const history = [];
  
    // Step 1: User asks for availability
    console.log('\n👤 User: Can we meet next Wednesday afternoon?\n');
    
    let response = await fetch('http://localhost:3002/api/chat/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Can we meet next Wednesday afternoon?',
        conversationHistory: history,
        bookingState,
      }),
    });
  
    let data = await response.json();
    console.log('🤖 AI:', data.data.response);
    bookingState = data.data.bookingState;
    history.push({ role: 'user', content: 'Can we meet next Wednesday afternoon?' });
    history.push({ role: 'assistant', content: data.data.response });
  
    // Step 2: User selects slot
    console.log('\n👤 User: 2pm sounds perfect\n');
    
    response = await fetch('http://localhost:3002/api/chat/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '2pm sounds perfect',
        conversationHistory: history,
        bookingState,
      }),
    });
  
    data = await response.json();
    console.log('🤖 AI:', data.data.response);
    bookingState = data.data.bookingState;
  
    // Step 3: User provides email
    console.log('\n👤 User: pavan2000.t@gmail.com\n');
    
    response = await fetch('http://localhost:3002/api/chat/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'pavan2000.t@gmail.com',
        conversationHistory: history,
        bookingState,
      }),
    });
  
    data = await response.json();
    console.log('🤖 AI:', data.data.response);
    bookingState = data.data.bookingState;
  
    // Step 4: User skips phone
    console.log('\n👤 User: skip\n');
    
    response = await fetch('http://localhost:3002/api/chat/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'skip',
        conversationHistory: history,
        bookingState,
      }),
    });
  
    data = await response.json();
    console.log('🤖 AI:', data.data.response);
    bookingState = data.data.bookingState;
  
    // Step 5: User confirms
    console.log('\n👤 User: yes\n');
    
    response = await fetch('http://localhost:3002/api/chat/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'yes',
        conversationHistory: history,
        bookingState,
      }),
    });
  
    data = await response.json();
    console.log('🤖 AI:', data.data.response);
    console.log('\n✅ Booking Created:', data.data.bookingCreated);
    if (data.data.booking) {
      console.log('📋 Confirmation Code:', data.data.booking.confirmationCode);
    }
  }
  
  testConversationalBooking();