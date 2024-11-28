let peerConnection;
let dataChannel;
let fileChunks = [];
let currentFile = null;
let receivedSize = 0;
let fileSize = 0;
const CHUNK_SIZE = 16384;
const MAX_FILE_SIZE = 2000 * 1024 * 1024; // 100MB limit
const manifestStructure = {
    fileName: '',
    totalSize: 0,
    chunks: [],
    chunkSize: CHUNK_SIZE,
    timestamp: ''
};
let downloadDirectory = null;

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

async function selectDownloadFolder() {
    try {
        downloadDirectory = await window.showDirectoryPicker();
        return downloadDirectory;
    } catch (e) {
        console.error('Error selecting folder:', e);
        return null;
    }
}

// Function to check for existing transfer
async function checkExistingTransfer(folderHandle, fileName) {
    try {
        const manifestHandle = await folderHandle.getFileHandle(fileName + '.manifest', { create: false });
        const manifestFile = await manifestHandle.getFile();
        const manifestData = JSON.parse(await manifestFile.text());
        
        // Check for existing chunks
        const existingChunks = [];
        for (let i = 0; i < manifestData.chunks.length; i++) {
            try {
                const chunkHandle = await folderHandle.getFileHandle(`${fileName}.chunk.${i}`, { create: false });
                const chunkFile = await chunkHandle.getFile();
                existingChunks[i] = chunkFile;
            } catch {
                // Chunk doesn't exist
            }
        }
        
        return {
            manifest: manifestData,
            chunks: existingChunks
        };
    } catch {
        return null;
    }
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

    let downloadDirectory = null;
    let currentChunkIndex = undefined;

    async function handleFileTransfer(manifest) {
        try {
            if (!downloadDirectory) {
                downloadDirectory = await window.showDirectoryPicker();
            }
            
            const existingManifest = await checkForExistingManifest(downloadDirectory, manifest.fileName);
            if (existingManifest) {
                const resume = confirm(`Partially downloaded file found. Resume download?`);
                if (resume) {
                    fileChunks = existingManifest.chunks;
                    receivedSize = existingManifest.receivedSize;
                } else {
                    await cleanupExistingTransfer(downloadDirectory, manifest.fileName);
                    fileChunks = new Array(manifest.chunks.length);
                    receivedSize = 0;
                }
            } else {
                fileChunks = new Array(manifest.chunks.length);
                receivedSize = 0;
            }

            fileSize = manifest.totalSize;
            currentFile = manifest;
            
            updateTransferStatus();
        } catch (error) {
            console.error('Error setting up file transfer:', error);
            alert('Failed to setup file transfer. Please try again.');
        }
    }

    async function handleChunkReceived(chunkData) {
        try {
            const chunkFileName = `${currentFile.fileName}.chunk.${currentChunkIndex}`;
            await saveChunk(downloadDirectory, chunkFileName, chunkData);
            
            fileChunks[currentChunkIndex] = chunkData;
            receivedSize += chunkData.byteLength;
            
            updateTransferStatus();

            if (isTransferComplete()) {
                await finalizeTransfer();
            }
        } catch (error) {
            console.error('Error handling chunk:', error);
            document.getElementById('file-status').textContent = 'Error receiving chunk. Transfer paused.';
        }
    }

    async function finalizeTransfer() {
        try {
            const finalFile = new Blob(fileChunks);
            await saveCompletedFile(downloadDirectory, currentFile.fileName, finalFile);
            await cleanupTransferFiles();
            
            addDownloadLink(finalFile);
            resetTransferState();
        } catch (error) {
            console.error('Error finalizing transfer:', error);
            document.getElementById('file-status').textContent = 'Error completing transfer.';
        }
    }

    channel.onmessage = async event => {
        if (typeof event.data === 'string') {
            try {
                const message = JSON.parse(event.data);
                switch (message.type) {
                    case 'manifest':
                        await handleFileTransfer(message.manifest);
                        break;
                    case 'chunk-meta':
                        currentChunkIndex = message.chunkIndex;
                        break;
                    case 'username':
                        channel.remoteUsername = message.username;
                        document.getElementById('connection-status').textContent = 
                            `Connected with ${message.username}`;
                        break;
                    default:
                        displayChatMessage(channel.remoteUsername || 'Other user', message);
                }
            } catch (e) {
                displayChatMessage(channel.remoteUsername || 'Other user', event.data);
            }
        } else if (currentFile && currentChunkIndex !== undefined) {
            await handleChunkReceived(event.data);
        }
    };
}

// Helper functions
function updateTransferStatus() {
    const progress = Math.round((receivedSize / fileSize) * 100);
    document.getElementById('file-status').textContent = 
        `Receiving ${currentFile.fileName}... ${progress}%`;
}

function isTransferComplete() {
    return !fileChunks.includes(undefined);
}

function displayChatMessage(username, message) {
    const messages = document.getElementById('messages');
    messages.innerHTML += `<p>${username}: ${message}</p>`;
    messages.scrollTop = messages.scrollHeight;
}

async function checkForExistingManifest(folderHandle, fileName) {
    try {
        // Try to get manifest file handle
        const manifestHandle = await folderHandle.getFileHandle(fileName + '.manifest', { create: false });
        const manifestFile = await manifestHandle.getFile();
        const manifestData = JSON.parse(await manifestFile.text());

        // Check for existing chunks
        const chunks = new Array(manifestData.chunks.length);
        let receivedSize = 0;

        for (let i = 0; i < manifestData.chunks.length; i++) {
            try {
                const chunkHandle = await folderHandle.getFileHandle(`${fileName}.chunk.${i}`, { create: false });
                const chunkFile = await chunkHandle.getFile();
                chunks[i] = await chunkFile.arrayBuffer();
                receivedSize += chunks[i].byteLength;
            } catch {
                // Chunk doesn't exist, leave as undefined
            }
        }

        return {
            ...manifestData,
            chunks,
            receivedSize
        };
    } catch {
        // No manifest found
        return null;
    }
}

async function saveChunk(folderHandle, chunkFileName, chunkData) {
    const chunkHandle = await folderHandle.getFileHandle(chunkFileName, { create: true });
    const writable = await chunkHandle.createWritable();
    await writable.write(chunkData);
    await writable.close();
}

async function saveCompletedFile(folderHandle, fileName, fileBlob) {
    const fileHandle = await folderHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(fileBlob);
    await writable.close();
}

async function cleanupTransferFiles() {
    try {
        const baseFileName = currentFile.fileName;
        // Remove all chunk files
        for (let i = 0; i < currentFile.chunks.length; i++) {
            try {
                await downloadDirectory.removeEntry(`${baseFileName}.chunk.${i}`);
            } catch (e) {
                console.warn(`Failed to remove chunk ${i}`, e);
            }
        }
        // Remove manifest
        try {
            await downloadDirectory.removeEntry(`${baseFileName}.manifest`);
        } catch (e) {
            console.warn('Failed to remove manifest', e);
        }
    } catch (e) {
        console.error('Error during cleanup:', e);
    }
}

async function cleanupExistingTransfer(folderHandle, fileName) {
    try {
        // Try to get manifest to know how many chunks to clean
        const manifestHandle = await folderHandle.getFileHandle(fileName + '.manifest', { create: false });
        const manifestFile = await manifestHandle.getFile();
        const manifestData = JSON.parse(await manifestFile.text());

        // Remove all possible chunks
        for (let i = 0; i < manifestData.chunks.length; i++) {
            try {
                await folderHandle.removeEntry(`${fileName}.chunk.${i}`);
            } catch {
                // Ignore if chunk doesn't exist
            }
        }

        // Remove manifest
        await folderHandle.removeEntry(`${fileName}.manifest`);
    } catch {
        // If manifest doesn't exist, nothing to clean
    }
}

// Error handling wrapper
async function withErrorHandling(operation, errorMessage, defaultValue = null) {
    try {
        return await operation();
    } catch (error) {
        console.error(errorMessage, error);
        if (error.name === 'NotAllowedError') {
            alert('Permission denied. Please allow access to continue.');
        } else {
            alert(errorMessage);
        }
        return defaultValue;
    }
}

// Progress tracking helper
function updateProgressUI(current, total, fileName) {
    const progress = Math.round((current / total) * 100);
    const status = document.getElementById('file-status');
    status.textContent = `${fileName}: ${progress}% (${formatSize(current)} of ${formatSize(total)})`;
}

// Size formatting helper
function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function addDownloadLink(blob) {
    const div = document.getElementById('received-files');
    const link = document.createElement('a');
    try {
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = currentFile.fileName;
        link.textContent = `Download ${currentFile.fileName} (${fileSize} bytes)`;
        link.onclick = () => setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (e) {
        link.href = '#';
        link.textContent = `${currentFile.fileName} (${fileSize} bytes) - Save not supported`;
    }
    div.appendChild(link);
    div.appendChild(document.createElement('br'));
}

function resetTransferState() {
    fileChunks = [];
    currentChunkIndex = undefined;
    document.getElementById('file-status').textContent = 'File received!';
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
    
    // Create manifest
    const manifest = {
        ...manifestStructure,
        fileName: file.name,
        totalSize: file.size,
        timestamp: new Date().toISOString(),
        chunks: Array.from({ length: Math.ceil(file.size / CHUNK_SIZE) }, 
            (_, i) => ({
                index: i,
                size: Math.min(CHUNK_SIZE, file.size - (i * CHUNK_SIZE)),
                status: 'pending'
            }))
    };

    // Send manifest first
    dataChannel.send(JSON.stringify({
        type: 'manifest',
        manifest: manifest
    }));

    const reader = new FileReader();
    let chunkIndex = 0;

    reader.onload = (e) => {
        // Send chunk with metadata
        dataChannel.send(JSON.stringify({
            type: 'chunk-meta',
            chunkIndex: chunkIndex,
            fileName: file.name
        }));
        
        // Send actual chunk data
        dataChannel.send(e.target.result);
        
        chunkIndex++;
        const progress = Math.round((chunkIndex * CHUNK_SIZE / file.size) * 100);
        document.getElementById('file-status').textContent = `Sending file... ${progress}%`;

        if (chunkIndex * CHUNK_SIZE < file.size) {
            readNextChunk();
        } else {
            document.getElementById('file-status').textContent = 'File sent!';
            resetFileInput();
        }
    };

    const readNextChunk = () => {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const slice = file.slice(start, end);
        reader.readAsArrayBuffer(slice);
    };

    readNextChunk();
};