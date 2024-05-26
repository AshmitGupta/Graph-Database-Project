const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
let isRecording = false;

// Configure recognition settings
recognition.continuous = false;
recognition.interimResults = false;
recognition.lang = 'en-US';

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
    }
    sendButton.disabled = false;
});

document.getElementById('image-input').addEventListener('change', function () {
    const queryInput = document.getElementById('query-input');
    if (this.files.length > 0) {
        queryInput.value = this.files[0].name;
    }
});

document.getElementById('audio-label').addEventListener('click', function () {
    const queryInput = document.getElementById('query-input');
    if (!isRecording) {
        console.log('Starting recording...');
        recognition.start();
        isRecording = true;
        document.getElementById('audio-label').classList.add('recording');
        queryInput.placeholder = "Recording...";
    } else {
        console.log('Stopping recording...');
        recognition.stop();
        isRecording = false;
        document.getElementById('audio-label').classList.remove('recording');
        queryInput.placeholder = "Enter your query here";
    }
});

recognition.onresult = function (event) {
    console.log('Recognition result event:', event);
    const transcript = event.results[0][0].transcript;
    console.log('Transcript:', transcript);
    const queryInput = document.getElementById('query-input');
    queryInput.value = transcript;
    recognition.stop(); // Ensure recognition is stopped after result
    isRecording = false;
    document.getElementById('audio-label').classList.remove('recording');
    queryInput.placeholder = "Enter your query here";
};

recognition.onspeechend = function() {
    console.log('Speech has ended');
    recognition.stop();
    isRecording = false;
    document.getElementById('audio-label').classList.remove('recording');
    const queryInput = document.getElementById('query-input');
    queryInput.placeholder = "Enter your query here";
};

recognition.onerror = function (event) {
    console.error('Speech recognition error detected:', event.error);
    const queryInput = document.getElementById('query-input');
    queryInput.placeholder = "Error in recording. Try again.";
    isRecording = false;
    document.getElementById('audio-label').classList.remove('recording');
};
