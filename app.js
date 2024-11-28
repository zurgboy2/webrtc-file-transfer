let peerConnection;
let dataChannel;
let fileChunks = [];
let currentFile = null;
let receivedSize = 0;
let fileSize = 0;
const CHUNK_SIZE = 16384;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB limit

function cleanup() {
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    // Reset UI elements
    document.getElementById('connection-status').textContent = 'Disconnected';
    document.getElementById('signaling-area').style.display = 'block';
    document.getElementById('chat-area').style.display = 'none';
    document.getElementById('file-transfer-area').style.display = 'none';
    document.getElementById('local-desc').value = '';
    document.getElementById('remote-desc').value = '';
    document.getElementById('messages').innerHTML = '';
    document.getElementById('file-status').textContent = '';
    resetFileInput();
}

function resetFileInput() {
    const fileInput = document.getElementById('file-input');
    fileInput.value = '';
    const fileIcon = document.getElementById('file-icon');
    const deleteFileBtn = document.getElementById('delete-file');
    fileIcon.classList.remove('file-selected');
    deleteFileBtn.classList.remove('visible');
    document.getElementById('file-name').textContent = 'No file selected';
}

function initWebRTC(username) {
    cleanup();

    peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ]
    });

    peerConnection.onicecandidate = event => {
        if (peerConnection.localDescription) {
            document.getElementById('local-desc').value = JSON.stringify(peerConnection.localDescription);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed') {
            cleanup();
        }
    };

    document.getElementById('connection-status').textContent = 'Initializing...';

    dataChannel = peerConnection.createDataChannel('chat');
    dataChannel.username = username;
    setupDataChannel(dataChannel);
}

document.getElementById('create-offer').onclick = async () => {
    const usernameInput = document.getElementById('username');
    if (!usernameInput.value) {
        alert('Please enter your username');
        return;
    }

    initWebRTC(usernameInput.value);

    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
    } catch (e) {
        console.error('Error creating offer:', e);
        document.getElementById('connection-status').textContent = 'Error: ' + e.message;
    }
};

document.getElementById('accept-offer').onclick = async () => {
    try {
        const remoteDescText = document.getElementById('remote-desc').value.trim();
        if (!remoteDescText) {
            alert('Please paste the description from the other device first');
            return;
        }

        let remoteDesc;
        try {
            remoteDesc = JSON.parse(remoteDescText);
        } catch (e) {
            console.error('Error parsing remote description:', e);
            document.getElementById('connection-status').textContent = 'Error: Invalid remote description';
            return;
        }

        const usernameInput = document.getElementById('username');
        if (!usernameInput.value) {
            alert('Please enter your username');
            return;
        }

        initWebRTC(usernameInput.value);

        peerConnection.ondatachannel = event => {
            dataChannel = event.channel;
            setupDataChannel(dataChannel);
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
    } catch (e) {
        console.error('Error accepting offer:', e);
        document.getElementById('connection-status').textContent = 'Error: ' + e.message;
    }
};

document.getElementById('remote-desc').addEventListener('input', async () => {
    if (!peerConnection || !peerConnection.localDescription) return;

    try {
        const remoteDesc = JSON.parse(document.getElementById('remote-desc').value);
        if (remoteDesc.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc));
        }
    } catch (e) {
        console.error('Error setting remote description:', e);
    }
});

function setupDataChannel(channel) {
    channel.onopen = () => {
        // Send username when channel opens if we're the offering peer
        if (channel.label === 'chat') {
            channel.send(JSON.stringify({
                type: 'username',
                username: document.getElementById('username').value
            }));
        }
        document.getElementById('connection-status').textContent = `Connected`;
        document.getElementById('signaling-area').style.display = 'none';
        document.getElementById('chat-area').style.display = 'block';
        document.getElementById('file-transfer-area').style.display = 'block';
    };

    channel.onmessage = event => {
        if (typeof event.data === 'string') {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'file-info') {
                    // Reset file transfer state
                    fileChunks = [];
                    receivedSize = 0;
                    fileSize = message.fileSize;
                    currentFile = {
                        name: message.fileName,
                        size: message.fileSize
                    };
                    document.getElementById('file-status').textContent = 
                        `Receiving ${message.fileName} (0%)`;
                } else if (message.type === 'username') {
                    channel.remoteUsername = message.username;
                    document.getElementById('connection-status').textContent = 
                        `Connected with ${message.username}`;
                } else {
                    // Regular chat message
                    const messages = document.getElementById('messages');
                    const username = channel.remoteUsername || 'Other user';
                    messages.innerHTML += `<p>${username}: ${message}</p>`;
                    messages.scrollTop = messages.scrollHeight;
                }
            } catch (e) {
                // Regular chat message (not JSON)
                const messages = document.getElementById('messages');
                const username = channel.remoteUsername || 'Other user';
                messages.innerHTML += `<p>${username}: ${event.data}</p>`;
                messages.scrollTop = messages.scrollHeight;
            }
        } else {
            // Handle file chunk
            fileChunks.push(event.data);
            receivedSize += event.data.byteLength;
            
            const progress = Math.round((receivedSize / fileSize) * 100);
            document.getElementById('file-status').textContent = 
                `Receiving file... ${progress}%`;

            if (receivedSize >= fileSize) {
                const blob = new Blob(fileChunks);
                const div = document.getElementById('received-files');
                const link = document.createElement('a');
                
                // Try-catch block for blob URL creation
                try {
                    const url = URL.createObjectURL(blob);
                    link.href = url;
                    link.download = currentFile.name;
                    link.textContent = `Download ${currentFile.name} (${currentFile.size} bytes)`;
                    
                    // Immediately revoke the URL after creating the link
                    link.onclick = () => {
                        setTimeout(() => {
                            URL.revokeObjectURL(url);
                        }, 100);
                    };
                } catch (e) {
                    console.error('Error creating blob URL:', e);
                    // Fallback for mobile devices
                    link.href = '#';
                    link.textContent = `${currentFile.name} (${currentFile.size} bytes) - Save not supported on this device`;
                }
                
                div.appendChild(link);
                div.appendChild(document.createElement('br'));
                
                // Cleanup
                fileChunks = [];
                document.getElementById('file-status').textContent = 'File received!';
            }
        }
    };
}

// Update send message handler to use username
document.getElementById('send-message').onclick = () => {
    const input = document.getElementById('message-input');
    if (dataChannel && dataChannel.readyState === 'open' && input.value) {
        dataChannel.send(input.value);
        const messages = document.getElementById('messages');
        const username = document.getElementById('username').value || 'You';
        messages.innerHTML += `<p>${username}: ${input.value}</p>`;
        messages.scrollTop = messages.scrollHeight;
        input.value = '';
    }
};

document.getElementById('disconnect').onclick = cleanup;


document.getElementById('file-input').addEventListener('change', () => {
    const fileInput = document.getElementById('file-input');
    const file = fileInput.files[0];
    const fileName = file ? file.name : 'No file selected';
    const fileIcon = document.getElementById('file-icon');
    const deleteFileBtn = document.getElementById('delete-file');

    if (file) {
        if (file.size > MAX_FILE_SIZE) {
            alert('File is too large (max 100MB)');
            resetFileInput();
            return;
        }
        fileIcon.classList.add('file-selected');
        deleteFileBtn.classList.add('visible');
    } else {
        fileIcon.classList.remove('file-selected');
        deleteFileBtn.classList.remove('visible');
    }

    document.getElementById('file-name').textContent = fileName;
});

document.getElementById('delete-file').onclick = resetFileInput;

document.getElementById('send-file').onclick = async () => {
    const fileInput = document.getElementById('file-input');
    const file = fileInput.files[0];
    if (!file) {
        alert('Please select a file first');
        return;
    }

    if (file.size > MAX_FILE_SIZE) {
        alert('File is too large (max 100MB)');
        return;
    }

    if (!dataChannel || dataChannel.readyState !== 'open') {
        alert('Connection not established');
        return;
    }

    currentFile = file;

    dataChannel.send(JSON.stringify({
        type: 'file-info',
        fileName: file.name,
        fileSize: file.size
    }));

    const reader = new FileReader();
    let offset = 0;

    reader.onload = (e) => {
        dataChannel.send(e.target.result);
        offset += e.target.result.byteLength;

        const progress = Math.round((offset / file.size) * 100);
        document.getElementById('file-status').textContent = `Sending file... ${progress}%`;

        if (offset < file.size) {
            readNextChunk();
        } else {
            document.getElementById('file-status').textContent = 'File sent!';
            resetFileInput();
        }
    };

    const readNextChunk = () => {
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        reader.readAsArrayBuffer(slice);
    };

    readNextChunk();
};