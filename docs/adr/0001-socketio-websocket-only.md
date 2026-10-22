# Socket.IO restricted to the WebSocket transport

Requirement R2 says chat traffic between the server and each client must use socket programming only. Socket.IO starts on HTTP long-polling by default and can fall back to it, which would carry chat messages over plain HTTP requests, so both the NestJS gateway and the client set `transports: ['websocket']`. Don't remove it to "fix" a connection problem; fix the network instead.

## Considered Options

- **Plain `ws`**: closest to the bare protocol, but Rooms and broadcasting would be hand-written.
- **Raw TCP (`net`)**: purest socket programming, but browsers can't open TCP sockets, so the client couldn't be a web page.
