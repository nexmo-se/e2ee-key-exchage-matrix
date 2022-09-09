- Every time a connection is created, every client establishes a 1-1 olm session with the new connection's client. The 1-1 olm sessions allow exchanging of peer-to-peer encrypted messages over unsecure channels. OpenTok signal() is used in this example.
- To setup the 1-1 olm session, OpenTok signal() is used to exchange the public key information. This is not a weakness in the protocol. The public keys could be available in a REST API server (like in Matrix), for anybody to download.
- When the lead client connects to the session, it creates a megolm group session. The group session key will be known by all megolm group members and it will be used as the OpenTok session E2E secret. The megolm session key changes (it is "ratcheted") with every group message.
- Every time a connection is created, the lead client sends the information needed to join the group session over the encrypted 1-1 olm session established with that client.
- Every time the lead client sends a message to the megolm group, it includes the encypted group session key. All clients receiving the group message shall set the E2E secret with the value of the group session key (the group session key is actually truncated to conform with the OT E2E API).
- Every time a connection is destroyed, a new group message should also be sent so the megolm group session key is changed, and the OpenTok session E2E secret updated by the remaining clients.
- All messages are signed to verify the sending client against the public key information exchanged when the 1-1 olm session is established. This is compared against the connectionId.

Caveats:
- This is a very simple application, assumed to have only one publisher, the "lead" client is the publisher. In production, if the same scheme is to be used, the application would need to designate the "lead" client, based on business logic or use case.
- If the "lead" client disconnects, either a new "lead" client needs to be selected and existing session recovered, or the session must restart with the new "leader".

Read https://matrix.org/docs/guides/end-to-end-encryption-implementation-guide for further reference

