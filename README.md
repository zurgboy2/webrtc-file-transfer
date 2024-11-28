# WebRTC File Transfer & Chat

A peer-to-peer file transfer and chat application using WebRTC. This application allows direct browser-to-browser communication for sending files and messages without going through a server.

## Features

- Real-time peer-to-peer chat
- File transfer between peers
- No server storage required for files
- Modern dark-themed UI
- Supports large file transfers
- Username identification

## How to Use

1. Open the application in two different browsers or devices
2. In the first browser:
   - Enter your username
   - Click "Create Offer"
   - Copy the generated offer text
3. In the second browser:
   - Enter your username
   - Paste the offer text in the "Remote Description" field
   - Click "Accept Offer"
   - Copy the generated answer text
4. Back in the first browser:
   - Paste the answer text in the "Remote Description" field
5. The connection will be established and you can start chatting and sending files!

## Technical Details

- Built with vanilla JavaScript
- Uses WebRTC DataChannel for peer-to-peer communication
- Implements file chunking for large file transfers
- Uses STUN servers for NAT traversal

## Live Demo

You can try the application at: [Your GitHub Pages URL]