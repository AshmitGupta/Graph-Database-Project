document.getElementById('query-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    
    const query = document.getElementById('query-input').value;
    const resultsDiv = document.getElementById('results');
    
    // Append the user's message to the chat
    const userMessageDiv = document.createElement('div');
    userMessageDiv.classList.add('message', 'sent');
    userMessageDiv.textContent = query;
    resultsDiv.appendChild(userMessageDiv);

    // Scroll to the bottom of the chat
    resultsDiv.scrollTop = resultsDiv.scrollHeight;

    try {
        // First, fetch the response from the Neo4j API
        const neo4jResponse = await fetch('/gpt-query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: query })
        });
        
        if (!neo4jResponse.ok) {
            const error = await neo4jResponse.json();
            const errorMessageDiv = document.createElement('div');
            errorMessageDiv.classList.add('message', 'received');
            errorMessageDiv.textContent = JSON.stringify(error, null, 2);
            resultsDiv.appendChild(errorMessageDiv);
            return;
        }
        
        const neo4jResult = await neo4jResponse.json();
        
        // Display the natural language explanation
        const responseMessageDiv = document.createElement('div');
        responseMessageDiv.classList.add('message', 'received');
        responseMessageDiv.textContent = neo4jResult.explanation;
        resultsDiv.appendChild(responseMessageDiv);

        // Scroll to the bottom of the chat
        resultsDiv.scrollTop = resultsDiv.scrollHeight;
    } catch (error) {
        const errorMessageDiv = document.createElement('div');
        errorMessageDiv.classList.add('message', 'received');
        errorMessageDiv.textContent = error.message;
        resultsDiv.appendChild(errorMessageDiv);
    }
});
