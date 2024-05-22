document.getElementById('query-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    
    const queryInput = document.getElementById('query-input');
    const imageInput = document.getElementById('image-input');
    const resultsDiv = document.getElementById('results');
    const sendButton = document.getElementById('send-button');

    sendButton.disabled = true;
    if (imageInput.files.length > 0) {
        // Handle image upload
        const imageFile = imageInput.files[0];
        const formData = new FormData();
        formData.append('image', imageFile);

        // Display the image in the chat
        const reader = new FileReader();
        reader.onload = function (e) {
            const userMessageDiv = document.createElement('div');
            userMessageDiv.classList.add('message', 'sent');
            const imgElement = document.createElement('img');
            imgElement.src = e.target.result;
            userMessageDiv.appendChild(imgElement);
            resultsDiv.appendChild(userMessageDiv);
            resultsDiv.scrollTop = resultsDiv.scrollHeight;
        };
        reader.readAsDataURL(imageFile);

        try {
            const imageResponse = await fetch('/gpt4-image', {
                method: 'POST',
                body: formData
            });

            if (!imageResponse.ok) {
                const error = await imageResponse.json();
                const errorMessageDiv = document.createElement('div');
                errorMessageDiv.classList.add('message', 'received');
                errorMessageDiv.textContent = JSON.stringify(error, null, 2);
                resultsDiv.appendChild(errorMessageDiv);
                return;
            }

            const imageResult = await imageResponse.json();
            const responseMessageDiv = document.createElement('div');
            responseMessageDiv.classList.add('message', 'received');
            responseMessageDiv.textContent = imageResult.explanation;
            resultsDiv.appendChild(responseMessageDiv);
            resultsDiv.scrollTop = resultsDiv.scrollHeight;
        } catch (error) {
            const errorMessageDiv = document.createElement('div');
            errorMessageDiv.classList.add('message', 'received');
            errorMessageDiv.textContent = error.message;
            resultsDiv.appendChild(errorMessageDiv);
        }

        // Clear the image input
        imageInput.value = '';
        queryInput.value = '';
    } else if (queryInput.value.trim() !== "") {
        // Handle text query
        const query = queryInput.value;
        const userMessageDiv = document.createElement('div');
        userMessageDiv.classList.add('message', 'sent');
        userMessageDiv.textContent = query;
        resultsDiv.appendChild(userMessageDiv);

        resultsDiv.scrollTop = resultsDiv.scrollHeight;

        const messages = [];
        const messageElements = resultsDiv.getElementsByClassName('message');
        for (let messageElement of messageElements) {
            const role = messageElement.classList.contains('sent') ? 'user' : 'assistant';
            messages.push({ role: role, content: messageElement.textContent });
        }

        try {
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
            const responseMessageDiv = document.createElement('div');
            responseMessageDiv.classList.add('message', 'received');
            responseMessageDiv.textContent = gpt4Result.explanation;
            resultsDiv.appendChild(responseMessageDiv);
            resultsDiv.scrollTop = resultsDiv.scrollHeight;
        } catch (error) {
            const errorMessageDiv = document.createElement('div');
            errorMessageDiv.classList.add('message', 'received');
            errorMessageDiv.textContent = error.message;
            resultsDiv.appendChild(errorMessageDiv);
        }

        queryInput.value = '';
        sendButton.disabled = false;
    }
});

document.getElementById('image-input').addEventListener('change', function () {
    const queryInput = document.getElementById('query-input');
    if (this.files.length > 0) {
        queryInput.value = this.files[0].name;
    }
});
