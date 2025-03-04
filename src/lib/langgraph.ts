import { generateRagResponse, isAppointmentQuery, isContactQuery } from './langchain';

// Define the state types
export interface ConversationState {
  messages: { role: string; content: string }[];
  intent?: 'general' | 'appointment' | 'contact' | 'info';
  appointmentData?: any;
  contactData?: any;
}

export interface ConversationResponse {
  response: string;
  intent?: 'general' | 'appointment' | 'contact' | 'info';
  action?: {
    type: 'bookAppointment' | 'sendMessage';
    data: any;
  };
}

// Define the nodes in our LangGraph

// Node 1: Detect intent
const detectIntent = async (state: ConversationState): Promise<ConversationState> => {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if (lastMessage.role !== 'user') {
    return state;
  }
  
  const query = lastMessage.content;
  
  // Detect intent based on the query
  let intent: 'general' | 'appointment' | 'contact' | 'info' = 'general';
  
  if (isAppointmentQuery(query)) {
    intent = 'appointment';
  } else if (isContactQuery(query)) {
    intent = 'contact';
  } else {
    intent = 'info';
  }
  
  return {
    ...state,
    intent,
  };
};

// Node 2: Extract appointment data
const extractAppointmentData = async (state: ConversationState): Promise<ConversationState> => {
  if (state.intent !== 'appointment') {
    return state;
  }
  
  // In a real implementation, we would use entity extraction here
  // For now, we'll just return a placeholder
  return {
    ...state,
    appointmentData: {
      intent: 'book_appointment',
    },
  };
};

// Node 3: Extract contact data
const extractContactData = async (state: ConversationState): Promise<ConversationState> => {
  if (state.intent !== 'contact') {
    return state;
  }
  
  // In a real implementation, we would use entity extraction here
  // For now, we'll just return a placeholder
  return {
    ...state,
    contactData: {
      intent: 'send_message',
    },
  };
};

// Node 4: Generate response
const generateResponse = async (state: ConversationState): Promise<ConversationResponse> => {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if (lastMessage.role !== 'user') {
    return { response: "I'm sorry, I don't understand." };
  }
  
  const query = lastMessage.content;
  const response = await generateRagResponse(query);
  
  // Determine if any action should be taken
  let action = undefined;
  
  if (state.intent === 'appointment' && state.appointmentData) {
    action = {
      type: 'bookAppointment' as const,  // Using 'as const' to fix the type error
      data: state.appointmentData,
    };
  } else if (state.intent === 'contact' && state.contactData) {
    action = {
      type: 'sendMessage' as const,  // Using 'as const' to fix the type error
      data: state.contactData,
    };
  }
  
  return {
    response,
    intent: state.intent,
    action,
  };
};

// Main function to process a message
export const processConversation = async (
  messages: { role: string; content: string }[]
): Promise<ConversationResponse> => {
  // Initialize state
  let state: ConversationState = {
    messages,
  };
  
  // Run through the graph nodes
  state = await detectIntent(state);
  
  if (state.intent === 'appointment') {
    state = await extractAppointmentData(state);
  } else if (state.intent === 'contact') {
    state = await extractContactData(state);
  }
  
  // Generate response
  return await generateResponse(state);
};