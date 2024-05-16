document.getElementById('query-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    
    const query = document.getElementById('query-input').value;
    const response = await fetch('/gpt-query', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: query })
    });
    
    const result = await response.json();
    const resultsDiv = document.getElementById('results');
    
    if (response.ok) {
        resultsDiv.innerHTML = '<pre>' + JSON.stringify(result, null, 2) + '</pre>';
    } else {
        resultsDiv.innerHTML = '<pre style="color: red;">' + JSON.stringify(result, null, 2) + '</pre>';
    }
});