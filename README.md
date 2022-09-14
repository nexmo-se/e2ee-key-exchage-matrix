# DO NOT USE THIS CODE AS IT IS FOR SECURITY SENSITIVE USE CASES

# simple-video-e2ee-matrix

Video end-to-end encryption keys negotiated among the clients using olm/megolm protocol. The application or Vonage video plataform do not take part in the key agreement or rotation.

- Every time a connection is created, every client establishes a 1-1 olm session with the new connection's client. The 1-1 olm sessions allow exchanging of peer-to-peer encrypted messages over unsecure channels. OpenTok signal() is used in this example
- To setup the 1-1 olm session, OpenTok signal() is used to exchange the public key information. This is not a weakness in the protocol. As an alternative, the public keys could be available in a REST API server (like in Matrix), for anybody to download
- When the lead client connects to the session, it creates a megolm group session. The group session key will be known by all megolm group members and it will be used as the OpenTok session E2E secret. The megolm session key changes (it is "ratcheted") with every group message
- Every time a connection is created, the lead client sends the information needed to join the group session over the encrypted 1-1 olm session established with that client
- Every time the lead client sends a message to the megolm group, it includes the encypted group session key. All clients receiving the group message shall set the E2E secret with the value of the group session key
  - the group session key is actually truncated to conform with the OT E2E API
- Every time a connection is destroyed, the lead client sends a new group message so the megolm group session key is changed, and the OpenTok session E2E secret updated by the remaining clients
- All messages are signed to verify the sending client against the public key information exchanged when the 1-1 olm session is established. This is compared against the connectionId but could also be compared against other identification if desired

Caveats:

- The approach fits more naturally a per-stream e2e secret, with the publisher "leading" key establishment and rotation for their published streams.
  It can be used for the current per session e2e secret, with the application electing a "lead" client bootstrapping the key establishment and rotation. This is what the example does.
- If the "lead" client disconnects, either a new "lead" client needs to be selected and existing session recovered, or the session must restart with the new "leader". This is currently a TODO. Another potential option is to set up a remote client on the cloud that play the role of lead client throughout the session.

Read https://matrix.org/docs/guides/end-to-end-encryption-implementation-guide for further reference

## Usage

- Create a `env` file as per `.env.example` and start the server by running node server.js
- Open index.html on a browser supported by OpenTok E2E encryption, open several tabs
- Choose one of the browser tabs as the "lead" client. Click "Get camera" and "Connect and publish as lead", this will start publishing from that client
- On the other tabs, Click "Get camera" and then click "Connect and publish as participant" to join the session and publish. Check the console to see the E2E secret changes and messages exchanged
- Closing already connected tabs will simulate disconnections
- If you close the lead client's tab and then you open a new tab as a participant, you won't be able to decrypt the media from the other participant because the lead client is no longer exchanging the group session information.

This is a very simple, basic, application, do not expect fancy eyecandy

## Notes on olm library

- The files olm.js, olm.wasm and olm.d.ts are included to facilitate the application usage. They are built from https://gitlab.matrix.org/matrix-org/olm.git, release 3.2.12
