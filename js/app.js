import { OTOlmUser } from './app_olm.js';

// session has to be created enabling e2e
var apiKey = '';
var sessionId = '';
var token = '';
var SAMPLE_SERVER_BASE_URL = 'http://localhost:3000';
let publisher;

function handleError(error) {
  if (error) {
    console.error(error);
  }
}

async function initPublisher() {
  publisher = OT.initPublisher('publisher', {}, function (err) {
    if (err) {
      console.error('init publisher error', err);
      return;
    }
    publisher.on('streamDestroyed', (event) => {
      console.log(new Date().toISOString() + ' My own streamDestroyed');
    });
  });
}

// olm
let thisOlmUser;
let publisherOlmUser;
let subscriberOlmUser;
let olmOutboundGroupSession;
let olmInboundGroupSession;
// map connectionId - key information, used to demultiplex incoming signal
let connectionOlmPeersMap = new Map();
// maps peerId to outgoing olm sessions
var outgoingOlmSessionOlmPeersMap = {};
// maps peerId to incoming olm sessions
var incomingOlmSessionOlmPeersMap = {};
// maps peerId to incoming group sessions
var olmGroupSessionOlmPeersMap = {};

const OT_ENCRYPTION_SECRET_MAX_LENGTH = 256; // 257 does not work
const INITIAL_OT_ENCRYPTION_SECRET = new Date().toISOString();

function generateOTEncryptionSecretFromString(sessionKey) {
  if (sessionKey.length <= OT_ENCRYPTION_SECRET_MAX_LENGTH) {
    return sessionKey;
  }
  return sessionKey.slice(-OT_ENCRYPTION_SECRET_MAX_LENGTH);
}

const MESSAGE_OLM_PUBLIC_KEYS = 'keys';
const OLM_MESSAGE_GROUP = 'group';
const OLM_MESSAGE_1_TO_1 = '1-to-1';
const OLM_MESSAGE_1_TO_1_CHAT = 'chat';
const OLM_MESSAGE_1_TO_1_GROUP_MATERIAL = 'group-material';

// get key material for the group session
function getJsonGroupSessionKeyData(groupSession) {
  var jsonGroupSessionKeyData = {
    session_id: groupSession.session_id(),
    session_key: groupSession.session_key(),
    message_index: groupSession.message_index(),
  };
  return jsonGroupSessionKeyData;
}

function getIdFromOlmKeys(jsonKeyData) {
  return jsonKeyData.curve25519;
}

function getSigningFromOlmKeys(jsonKeyData) {
  return jsonKeyData.ed25519;
}

function verifySignatureAndSender(
  text,
  signature,
  senderKey,
  expectedPeerKeyData
) {
  // TODO: do not create a new utility with every signature
  const olmUtility = new Olm.Utility();
  // verify signature
  const senderSigningKey = getSigningFromOlmKeys(expectedPeerKeyData);
  olmUtility.ed25519_verify(senderSigningKey, text, signature);
  // check the sender matches
  if (senderKey != getIdFromOlmKeys(expectedPeerKeyData)) {
    throw new Error(
      'sender does not match, sender_key: ' +
        senderKey +
        ', expected: ' +
        getIdFromOlmKeys(expectedPeerKeyData)
    );
  }
}

function setOTEncryptionSecretFromGroupSession(
  openTokSession,
  groupSessionKey
) {
  // set E2E key for the session
  const encryptionSecret =
    generateOTEncryptionSecretFromString(groupSessionKey);
  console.log(
    'setting E2E OT encryption secret to truncated group session key ' +
      encryptionSecret
  );
  openTokSession.setEncryptionSecret(encryptionSecret);
  // uncomment to set a corrupted a E2E key
  //const badEncryptionSecret = generateOTEncryptionSecretFromString(groupSessionKey.concat(new Date().toISOString()));
  //console.log('setting E2E OT encryption secret to corrupted group key ' + badEncryptionSecret);
  //openTokSession.setEncryptionSecret(badEncryptionSecret);
}

function addOlmPeer(remoteConnectionId, jsonKeyData) {
  console.log('olm: addOlmPeer() for connection: ' + remoteConnectionId);
  const peerId = getIdFromOlmKeys(jsonKeyData);
  if (connectionOlmPeersMap.has(remoteConnectionId)) {
    // already exists
    // this should not happen (?)
    console.log(
      'olm: peer already exists for connection: ' +
        remoteConnectionId +
        ', peerId: ' +
        peerId
    );
  }
  console.log(
    'olm: connection ' + remoteConnectionId + ', adding peer: ' + peerId
  );
  connectionOlmPeersMap.set(remoteConnectionId, jsonKeyData);
  return peerId;
}

function removeOlmPeer(remoteConnectionId) {
  console.log('olm: removeOlmPeer() for connection: ' + remoteConnectionId);
  return connectionOlmPeersMap.delete(remoteConnectionId);
}

function getOlmPeer(remoteConnectionId) {
  console.log('olm: getOlmPeer() for connection: ' + remoteConnectionId);
  return connectionOlmPeersMap.get(remoteConnectionId);
}

function getOrCreateOlmIncomingSession(jsonMsgData) {
  const senderKey = jsonMsgData.sender_key;
  const ciphertext = jsonMsgData.ciphertext;
  // check first for an existing session with peer
  var peerSession = incomingOlmSessionOlmPeersMap[senderKey];
  if (!peerSession) {
    // no existing session
    // if type is not zero, something is wrong
    if (ciphertext.type != 0) {
      throw new Error('Unknown one-to-one session');
    }
    // create new session and map it to the peerId
    peerSession = new Olm.Session();
    peerSession.create_inbound_from(
      thisOlmUser.olmAccount,
      senderKey,
      ciphertext.body
    );
    // remote the one time key used to set this session up
    thisOlmUser.olmAccount.remove_one_time_keys(peerSession);
    incomingOlmSessionOlmPeersMap[senderKey] = peerSession;
  }
  return peerSession;
}

function sendOlm1To1(
  peerSession,
  stringPeerMsg,
  otSession,
  remoteConnection,
  peerOneTimeKey
) {
  const encryptedPeerMsg = peerSession.encrypt(stringPeerMsg);
  const signature = thisOlmUser.olmAccount.sign(encryptedPeerMsg);
  const thisOlmUserIdKey = getIdFromOlmKeys(thisOlmUser.getIdKeys());
  const jsonPeerSignalData = {
    sender_key: thisOlmUserIdKey,
    ciphertext: encryptedPeerMsg,
    signature: signature,
  };
  const msg = {
    type: OLM_MESSAGE_1_TO_1,
    data: jsonPeerSignalData,
  };
  const signalOptions = {
    type: 'olm',
    to: remoteConnection,
    data: JSON.stringify(msg),
  };
  otSession.signal(signalOptions, function (error) {
    const remoteConnectionId = remoteConnection.connectionId;
    if (error) {
      console.log(
        'olm: signal error sending olm 1-1 msg to connection ' +
          remoteConnectionId +
          ': ' +
          error.message
      );
    } else {
      console.log(
        'olm: signal with olm 1-1 msg sent to connection ' + remoteConnectionId
      );
    }
  });
}

function sendOlmGroup(groupSession, stringGroupMsg, otSession) {
  const groupSessionKey = getJsonGroupSessionKeyData(
    olmOutboundGroupSession
  ).session_key;
  const payload = {
    group_session_key: groupSessionKey,
    plaintext: stringGroupMsg,
  };
  const payloadString = JSON.stringify(payload);
  const encryptedGroupMsg = groupSession.encrypt(payloadString);
  const signature = thisOlmUser.olmAccount.sign(encryptedGroupMsg);
  const thisOlmUserIdKey = getIdFromOlmKeys(thisOlmUser.getIdKeys());
  const jsonGroupSignalData = {
    sender_key: thisOlmUserIdKey,
    ciphertext: encryptedGroupMsg,
    signature: signature,
  };
  const msg = {
    type: OLM_MESSAGE_GROUP,
    data: jsonGroupSignalData,
  };
  // send to all client in the session
  const signalOptions = {
    type: 'olm',
    data: JSON.stringify(msg),
  };
  otSession.signal(signalOptions, function (error) {
    if (error) {
      console.log('olm: signal error sending olm group msg: ' + error.message);
    } else {
      console.log('olm: signal with olm group msg sent');
    }
  });
}
// end of olm

function startSession(leadClient) {
  // Olm
  if (leadClient) {
    publisherOlmUser = new OTOlmUser();
    thisOlmUser = publisherOlmUser;
    // publisher creates the group session
    // FOR_PRODUCTION: this should be done by the "lead" client
    olmOutboundGroupSession = new Olm.OutboundGroupSession();
    olmOutboundGroupSession.create();
  } else {
    subscriberOlmUser = new OTOlmUser();
    thisOlmUser = subscriberOlmUser;
  }
  // end of Olm
  console.log(
    'setting initial E2E OT encryption secret to ' +
      INITIAL_OT_ENCRYPTION_SECRET
  );
  var session = OT.initSession(apiKey, sessionId, {
    encryptionSecret: INITIAL_OT_ENCRYPTION_SECRET,
  });

  session.on({
    // signal is used only for olm
    'signal:olm': function (event) {
      const remoteConnection = event.from;
      const remoteConnectionId = remoteConnection.connectionId;
      console.log('olm signal received from connection: ' + remoteConnectionId);
      console.log('olm signal data: ' + event.data);
      try {
        const olmSignalData = JSON.parse(event.data);
        if (olmSignalData.type == MESSAGE_OLM_PUBLIC_KEYS) {
          // signal contains public keys and a one time key from the remote peer
          // this is not a message exchanged over olm
          const keyDataString = olmSignalData.data;
          const keyDataJson = JSON.parse(keyDataString);
          const peerPublishKeyData = keyDataJson.publishKeyData;
          const peerOneTimeKey = keyDataJson.oneTimeKey;
          const signature = olmSignalData.signature;
          const senderIdKey = getIdFromOlmKeys(peerPublishKeyData);
          // sender check will always work in this case
          verifySignatureAndSender(
            keyDataString,
            signature,
            senderIdKey,
            peerPublishKeyData
          );
          // add key material to the connection map
          addOlmPeer(remoteConnectionId, peerPublishKeyData);
          // set outgoing session with peer
          const peerId = getIdFromOlmKeys(peerPublishKeyData);
          var peerSession = outgoingOlmSessionOlmPeersMap[peerId];
          if (!peerSession) {
            peerSession = new Olm.Session();
            peerSession.create_outbound(
              thisOlmUser.olmAccount,
              peerId,
              peerOneTimeKey
            );
            outgoingOlmSessionOlmPeersMap[peerId] = peerSession;
          }
          // send test message, this is not needed
          const chatText = 'PING !!!!';
          const jsonPeerMsg = {
            type: OLM_MESSAGE_1_TO_1_CHAT,
            data: chatText,
          };
          sendOlm1To1(
            peerSession,
            JSON.stringify(jsonPeerMsg),
            session,
            remoteConnection,
            peerOneTimeKey
          );
          // sets the groupSession in motion if we are the publisher
          // FOR_PRODUCTION: this should be done by the "lead" client
          if (leadClient) {
            const groupSessionMaterialMsg = getJsonGroupSessionKeyData(
              olmOutboundGroupSession
            );
            const jsonPeerGroupSessionMaterialMsg = {
              type: OLM_MESSAGE_1_TO_1_GROUP_MATERIAL,
              data: groupSessionMaterialMsg,
            };
            // setup incoming group session
            olmInboundGroupSession = new Olm.InboundGroupSession();
            const groupSessionKey = groupSessionMaterialMsg.session_key;
            olmInboundGroupSession.create(groupSessionKey);
            // peerOneTimeKey will be ignored, we have already sent one message
            console.log(
              'olm: sending group session material to peer ' + peerId
            );
            sendOlm1To1(
              peerSession,
              JSON.stringify(jsonPeerGroupSessionMaterialMsg),
              session,
              remoteConnection,
              peerOneTimeKey
            );

            // set the E2E encryption secret for the OT session
            // this is skipped, the E2E encryption secret will be set when the group message is received
            // setOTEncryptionSecretFromGroupSession(session, groupSessionKey);

            // send a new group message, to rotate the group session, the message includes the encrypted group session key
            // group message recipients will change the OT session E2E secret to the received group session key value
            // note: sending this will change the encryption key used for the next group message
            sendOlmGroup(olmOutboundGroupSession, 'PING GROUP !!!', session);
          }
        } else if (olmSignalData.type == OLM_MESSAGE_GROUP) {
          // signal contains an olm group session message
          if (!olmInboundGroupSession) {
            // this should not happen
            console.error(
              'olm: group message received but no inbound group session exists, discarded'
            );
          } else {
            const jsonMsgData = olmSignalData.data;
            const ciphertext = jsonMsgData.ciphertext;
            const signature = jsonMsgData.signature;
            const senderKey = jsonMsgData.sender_key;
            const peerPublishKeyData =
              session.connection.id == remoteConnectionId
                ? // group message from myself
                  thisOlmUser.getIdKeys()
                : // group message from remote
                  getOlmPeer(remoteConnectionId);
            verifySignatureAndSender(
              ciphertext,
              signature,
              senderKey,
              peerPublishKeyData
            );
            const plaintext = olmInboundGroupSession.decrypt(ciphertext);
            // FIXME: process and analyse message_index
            const groupMsgIndex = plaintext.message_index;
            const payload = JSON.parse(plaintext.plaintext);
            const groupMsg = payload.plaintext;
            const groupSessionKey = payload.group_session_key;
            console.log(
              'olm: group olm message received, index:' +
                groupMsgIndex +
                ', peerId: ' +
                senderKey +
                ', msg: ' +
                groupMsg
            );
            // the group session key has advanced, the OT session E2E secret shall be updated
            setOTEncryptionSecretFromGroupSession(session, groupSessionKey);
          }
        } else if (olmSignalData.type == OLM_MESSAGE_1_TO_1) {
          // signal contains an olm 1-1 message from the peer
          const jsonMsgData = olmSignalData.data;
          const peerSession = getOrCreateOlmIncomingSession(jsonMsgData);
          const ciphertext = jsonMsgData.ciphertext;
          const signature = jsonMsgData.signature;
          const senderKey = jsonMsgData.sender_key;
          const peerPublishKeyData = getOlmPeer(remoteConnectionId);
          verifySignatureAndSender(
            ciphertext,
            signature,
            senderKey,
            peerPublishKeyData
          );
          const plaintext = peerSession.decrypt(
            ciphertext.type,
            ciphertext.body
          );
          console.log(
            'olm: peer olm message received, peerId: ' +
              senderKey +
              ', msg: ' +
              plaintext
          );
          const jsonReceivedMsg = JSON.parse(plaintext);
          if (jsonReceivedMsg.type == OLM_MESSAGE_1_TO_1_GROUP_MATERIAL) {
            // the message contains group session material
            const jsonGroupMaterialMsg = jsonReceivedMsg.data;
            olmInboundGroupSession = new Olm.InboundGroupSession();
            const sessionKey = jsonGroupMaterialMsg.session_key;
            olmInboundGroupSession.create(sessionKey);
            // set E2E key for the session
            setOTEncryptionSecretFromGroupSession(session, sessionKey);
          } else if (jsonReceivedMsg.type == OLM_MESSAGE_1_TO_1_CHAT) {
            // send reply, this is for fun
            const chatText = 'PONG !!!!';
            if (jsonReceivedMsg.data == chatText) {
              // do not create endless ping-pong
            } else {
              const jsonPeerMsg = {
                type: OLM_MESSAGE_1_TO_1_CHAT,
                data: chatText,
              };
              // outgoing session already exists, it is created when we receive the key material from the peer
              const peerId = senderKey;
              const outgoingPeerSession = outgoingOlmSessionOlmPeersMap[peerId];
              sendOlm1To1(
                outgoingPeerSession,
                JSON.stringify(jsonPeerMsg),
                session,
                remoteConnection
              );
            }
          } else {
            console.error(
              'olm: unrecognized type in incoming olm 1-1 message: ',
              jsonReceivedMsg.type
            );
          }
        } else if (olmSignalData.type) {
          console.error(
            'olm: unrecognized type in incoming olm signal: ',
            olmSignalData.type
          );
        } else {
          console.error('olm: no type in incoming olm signal ', e);
        }
      } catch (e) {
        //console.error(e.message);
        console.error(e);
      }
    },

    connectionCreated: function (event) {
      console.log(
        new Date().toISOString() +
          ' connection created ' +
          event.connection.connectionId
      );
      // olm
      const remoteConnection = event.connection;
      const remoteConnectionId = remoteConnection.connectionId;
      if (remoteConnectionId != session.connection.id) {
        // send my public keys
        // this should be signed (https://matrix.org/docs/spec/appendices.html#signing-json)
        const jsonData = {
          publishKeyData: thisOlmUser.getIdKeys(),
          oneTimeKey: thisOlmUser.getOneTimeKey(),
        };
        const stringData = JSON.stringify(jsonData);
        const signature = thisOlmUser.olmAccount.sign(stringData);
        const msg = {
          type: MESSAGE_OLM_PUBLIC_KEYS,
          data: stringData,
          signature: signature,
        };
        const signalOptions = {
          type: 'olm',
          to: remoteConnection,
          data: JSON.stringify(msg),
        };
        session.signal(signalOptions, function (error) {
          if (error) {
            console.log(
              'olm: signal error sending keys to connection ' +
                remoteConnectionId +
                ': ' +
                error.message
            );
          } else {
            console.log(
              'olm: signal with keys sent to connection ' + remoteConnectionId
            );
          }
        });
      } else {
        console.log(
          new Date().toISOString() + ' olm: ignoring my own connection'
        );
      }
      // end of olm
    },

    connectionDestroyed: function (event) {
      console.log(
        new Date().toISOString() +
          ' connection destroyed ' +
          event.connection.connectionId
      );
      // olm
      const remoteConnectionId = event.connection.connectionId;
      removeOlmPeer(remoteConnectionId);
      if (leadClient) {
        // send a new group message, to rotate the group session, the message includes the encrypted group session key
        // group message recipients will change the OT session E2E secret to the received group session key value
        // FOR_PRODUCTION: this should be done by the "lead" client
        // note: sending this will change the encryption key used for the next group message
        sendOlmGroup(olmOutboundGroupSession, 'PING GROUP !!!', session);
      }
      // end of olm
    },

    sessionReconnecting: function () {
      console.log(new Date().toISOString() + ' sessionReconnecting');
    },

    sessionReconnected: function () {
      console.log(new Date().toISOString() + ' sessionReconnected');
    },

    streamDestroyed: function (event) {
      console.log('streamDestroyed (not mine): ', event.stream.id);
    },

    sessionDisconnected: function () {
      console.log(new Date().toISOString() + ' sessionDisconnected');
    },

    streamCreated: function (event) {
      console.log(
        new Date().toISOString() +
          ' stream created from session, subscribing, streamId: ' +
          event.stream.id
      );
      let subscriber = session.subscribe(event.stream, 'subscriber2', {
        insertMode: 'append',
      });
    },

    sessionConnected: function () {
      // if (leadClient) {
      console.log('session connected, start to publish');
      publisher.on('streamCreated', function (event) {
        console.log('Publisher started streaming');
      });
      session.publish(publisher, function (error) {
        if (error) {
          console.log('publish() error:', error.message);
        } else {
          console.log('publish() had no error');
        }
      });
      // } else {
      //   console.log('session connected, subscribe only client');
      // }
    },
  });

  session.connect(token, function (error) {
    if (error) {
      console.log(error);
    } else {
      console.log('session connected');
    }
  });
}

document.getElementById('start-camera').addEventListener('click', function () {
  initPublisher();
});

document
  .getElementById('connect-publish')
  .addEventListener('click', function () {
    startSession(true);
  });

document.getElementById('connect').addEventListener('click', function () {
  startSession(false);
});

if (SAMPLE_SERVER_BASE_URL) {
  // Make an Ajax request to get the OpenTok API key, session ID, and token from the server
  fetch(SAMPLE_SERVER_BASE_URL + '/creds')
    .then(function fetch(res) {
      return res.json();
    })
    .then(function fetchJson(json) {
      apiKey = json.api_key;
      sessionId = json.sessionId;
      token = json.token;
      console.log(json);

      document.getElementById('connect-publish').style.visibility = 'visible';
      document.getElementById('start-camera').style.visibility = 'visible';
      document.getElementById('connect').style.visibility = 'visible';
    })
    .catch(function catchErr(error) {
      handleError(error);
      alert(
        'Failed to get opentok sessionId and token. Make sure you have updated the config.js file.'
      );
    });
}
