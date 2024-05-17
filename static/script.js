document.getElementById('query-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    
    const query = document.getElementById('query-input').value;
    const resultsDiv = document.getElementById('results');
    
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
            resultsDiv.textContent = JSON.stringify(error, null, 2)
            return;
        }
        
        const neo4jResult = await neo4jResponse.json();
        
        // Display the natural language explanation
        resultsDiv.textContent = neo4jResult.explanation;
    } catch (error) {
        resultsDiv.textContent = error.message;
    }
});
