// # self signed certs:
// openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./selfsigned.key -out selfsigned.crt
const express = require('express');
const Opentok = require('opentok');
//const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const app = express();
const dotenv = require('dotenv');
dotenv.config();

const opentok = new Opentok(process.env.api_key, process.env.api_secret);
if (!process.env.api_key || !process.env.api_secret)
  throw new Error('no creds found');

// directory to serve
const staticContentDirectory = path.join(__dirname, '/');
app.use(express.static(staticContentDirectory));

const createSession = async () => {
  return new Promise((res, rej) => {
    opentok.createSession({ e2ee: true }, function (err, session) {
      // Check if E2EE session was created successfully
      if (!err) {
        res(session);
      } else {
        rej(err);
      }
    });
  });
};

app.get('/creds', async (req, res) => {
  try {
    const session = await createSession();
    res.send({
      sessionId: session.sessionId,
      api_key: process.env.api_key,
      token: opentok.generateToken(session.sessionId),
    });
    // res.send('okay');
  } catch (e) {
    console.log(e);
  }
});

app.get('/favicon', async (req, res) => {
  try {
    const session = await createSession();
    res.sendStatus(200);
    // res.send('okay');
  } catch (e) {
    console.log(e);
  }
});

const serverPort = process.env.SERVER_PORT || process.env.PORT || 3000;
// start express server on port 5000
app.listen(serverPort, () => {
  console.log('server started on port', serverPort);
});
