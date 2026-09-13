// server.js
const http = require('http');

const port = 3000;

// Create the HTTP server
const server = http.createServer((req, res) => {
  // Set the response HTTP header with a 200 (OK) status and Content-Type
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  
  // Send the response body
  res.end('Hello from your Node.js server!\n');
});

// Start listening for incoming requests
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});