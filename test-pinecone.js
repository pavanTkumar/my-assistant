// fixed-pinecone-test.js
console.log('Script starting...');

// Try Pinecone connection with updated parameters
console.log('\nAttempting Pinecone connection with updated config...');
try {
  const { Pinecone } = require('@pinecone-database/pinecone');
  console.log('Pinecone package loaded');
  
  // Use a configuration without the environment parameter
  const apiKey = 'pcsk_2o8z8H_LgnUqYJQCDmtV91jZtfBB1RysWBjsESN8baw21pEncwSX2iXa7149N6BhmjMY7w';
  
  // Option 1: Try with just apiKey
  const pinecone = new Pinecone({ 
    apiKey
  });
  console.log('Pinecone instance created');
  
  // Make the API call inside an async function
  const testConnection = async () => {
    try {
      console.log('Making API call...');
      const indexes = await pinecone.listIndexes();
      console.log('Connection successful!');
      console.log('Available indexes:', indexes);
      
      if (indexes && indexes.length > 0) {
        console.log('\nTrying to access index "myassistant"...');
        const index = pinecone.index('myassistant');
        const stats = await index.describeIndexStats();
        console.log('Index stats:', stats);
      }
    } catch (error) {
      console.log('API call error:', error.message);
      if (error.response) {
        console.log('Error details:', error.response.data);
      }
    }
  };
  
  // Execute the test
  testConnection();
} catch (e) {
  console.log('Error with Pinecone setup:', e.message);
}

console.log('Script completed main execution (async operations may still be pending)');