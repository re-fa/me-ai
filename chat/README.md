# WebRTC Peer-to-Peer Chat

A simple peer-to-peer chat application that allows two devices to communicate directly through a WebRTC data channel.

## Live Demo

[Open the chat application](https://re-fa.github.io/me-ai/chat/)

## Overview

This application creates a direct connection between two browsers without requiring a traditional chat server to relay messages. The two users exchange connection information manually through an invitation code and an answer code.

After the connection is established, messages are exchanged through `RTCDataChannel`.

## How to Use

### On the first device

1. Open the [live application](https://re-fa.github.io/me-ai/chat/).
2. Use the **Create Invitation Code** section.
3. Wait until the connection information is ready.
4. Copy the invitation code.
5. Send the code to the second device through a private and trusted channel.

### On the second device

1. Open the same application.
2. Use the **Complete Connection** section.
3. Paste the invitation code.
4. Generate the answer code.
5. Copy the answer code and send it back to the first device.

### Back on the first device

1. Paste the answer code into the required field.
2. Complete the connection.
3. When the connection succeeds, both devices can exchange messages.

## Features

- Peer-to-peer communication using WebRTC.
- Message exchange through `RTCDataChannel`.
- Manual invitation and answer code exchange.
- Arabic user interface.
- Connection status and error messages.
- Copy-to-clipboard support for connection codes.
- Disconnect and retry functionality.
- Static deployment through GitHub Pages.

## Technologies

- HTML5
- CSS3
- JavaScript (ES6+)
- WebRTC
- `RTCPeerConnection`
- `RTCDataChannel`
- STUN and TURN servers
- GitHub Pages

## Project Structure

```text
chat/
├── README.md
├── index.html
├── styles.css
└── app.js
```

## How It Works

The application uses `RTCPeerConnection` to establish a WebRTC connection between two browsers.

The first device creates an offer. The second device uses that offer to create an answer. Both users exchange these connection descriptions manually through text codes.

STUN and TURN services help WebRTC discover a suitable network path. Once the connection is established, the application creates a data channel for sending and receiving text messages.

## Privacy and Security Notes

This project is experimental and educational. Do not use it to send passwords, financial information, or other sensitive data.

Invitation and answer codes should be shared only with the intended person. WebRTC may use a TURN server as a relay when a direct connection cannot be established. Therefore, a successful WebRTC connection does not always guarantee that every packet travelled directly between the two devices.

The application does not provide user accounts, message history, authentication, or permanent message storage. Messages may disappear when the page is refreshed or the connection is closed.

## Testing

The application has been tested successfully by establishing communication between two different devices and exchanging messages.

Connection results may vary depending on the browser, network configuration, firewall rules, and the availability of a suitable STUN or TURN route.

## Running Locally

Clone the repository:

```bash
git clone https://github.com/re-fa/me-ai.git
cd me-ai
```

Then serve the project with a local development server and open:

```text
chat/index.html
```

Using a local development server is recommended instead of opening the file directly, because some browser features work only in a secure context such as `localhost` or HTTPS.

## Role of Artificial Intelligence

The project was created with the assistance of artificial intelligence. My role included defining the idea, describing the requirements, reviewing the generated implementation, testing the application between two devices, and checking the connection and messaging behavior.

The AI was used as a software development assistant. The final implementation was tested and reviewed as part of the project process.

## Limitations

- Users must exchange invitation and answer codes manually.
- The application does not include a signaling server.
- There is no login or user identity system.
- Messages are not stored permanently.
- Some networks may block direct WebRTC connections.
- A TURN relay may be required for certain network configurations.

## License

This project is licensed under the [MIT License](../LICENSE).

[View the main repository](https://github.com/re-fa/me-ai)
