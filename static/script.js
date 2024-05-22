document.getElementById('query-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    
    const query = document.getElementById('query-input').value;
    document.getElementById('query-input').value = '';
    const resultsDiv = document.getElementById('results');
    
    // Append the user's message to the chat
    const userMessageDiv = document.createElement('div');
    userMessageDiv.classList.add('message', 'sent');
    userMessageDiv.textContent = query;
    resultsDiv.appendChild(userMessageDiv);

    // Scroll to the bottom of the chat
    resultsDiv.scrollTop = resultsDiv.scrollHeight;

    // Collect all messages and format them for GPT-4
    const messages = [];
    const messageElements = resultsDiv.getElementsByClassName('message');
    for (let messageElement of messageElements) {
        const role = messageElement.classList.contains('sent') ? 'user' : 'assistant';
        messages.push({ role: role, content: messageElement.textContent });
    }

    try {
        // Send the conversation to GPT-4 for processing
        const gpt4Response = await fetch('/gpt4-chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ messages: messages })
        });

        if (!gpt4Response.ok) {
            const error = await gpt4Response.json();
            const errorMessageDiv = document.createElement('div');
            errorMessageDiv.classList.add('message', 'received');
            errorMessageDiv.textContent = JSON.stringify(error, null, 2);
            resultsDiv.appendChild(errorMessageDiv);
            return;
        }

        const gpt4Result = await gpt4Response.json();

        // Display the natural language explanation from GPT-4
        const responseMessageDiv = document.createElement('div');
        responseMessageDiv.classList.add('message', 'received');
        responseMessageDiv.textContent = gpt4Result.explanation;
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
