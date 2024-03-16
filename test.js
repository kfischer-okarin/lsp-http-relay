const assert = require('assert');
const test = require('node:test');
const {
  buildJSONRPCMessage,
  buildValidMessage,
  buildValidServerResponses,
  closeServer,
  isPortUsed,
  killProcess,
  sendToBridgeProcess,
  startStubServer,
  startBridgeProcess,
  tryToReadFromStream,
  waitForNextRequest,
} = require('./testHelpers.js');


let bridgeProcess;
let server;

test.before(async () => {
  const portIsUsed = await isPortUsed(9001);
  if (portIsUsed) {
    throw new Error('Port 9001 is already in use');
  }
});

test.afterEach(async () => {
  if (bridgeProcess) {
    await killProcess(bridgeProcess);
  }
  if (server && server.listening) {
    await closeServer(server);
  }
});

test('Forwards JSON RPC requests to server', async () => {
  server = startStubServer(9001, [
    { status: 200, body: '{"response": "ok"}' },
  ]);
  bridgeProcess = startBridgeProcess();

  const response = await sendToBridgeProcess(bridgeProcess,
                                             'Content-Length: 23\r\n' +
                                             '\r\n' +
                                             '{"method":"initialize"}');

  assert.strictEqual(response,
                     'Content-Length: 18\r\n' +
                     '\r\n' +
                     '{"response": "ok"}');
  assert.deepStrictEqual(server.receivedRequests, [
    { method: 'POST', url: '/dragon/lsp', body: '{"method":"initialize"}' },
  ]);
});

test('Shows no output when server replies with 204', async () => {
  server = startStubServer(9001, [
    { status: 204, body: '' },
  ]);
  bridgeProcess = startBridgeProcess();

  const response = await sendToBridgeProcess(bridgeProcess, buildValidMessage());
  assert.strictEqual(response, null);
});

test('Bridge process ignores messages while no server is started', async () => {
  bridgeProcess = startBridgeProcess();
  await sendToBridgeProcess(bridgeProcess, buildJSONRPCMessage('{"messageNumber": 1}'));

  server = startStubServer(9001, buildValidServerResponses(1));
  await sendToBridgeProcess(bridgeProcess, buildJSONRPCMessage('{"messageNumber": 2}'));

  assert.deepStrictEqual(server.receivedRequests, [
    { method: 'POST', url: '/dragon/lsp', body: '{"messageNumber": 2}' },
  ]);
});

test('Bridge process keeps initialize message around for server starts', async () => {
  bridgeProcess = startBridgeProcess();
  await sendToBridgeProcess(bridgeProcess, buildJSONRPCMessage('{"method": "initialize"}'));

  server = startStubServer(9001, [
    { status: 200, body: '{"result": {}}' },
  ]);

  await waitForNextRequest(server);
  assert.deepStrictEqual(server.receivedRequests, [
    { method: 'POST', url: '/dragon/lsp', body: '{"method": "initialize"}' },
  ]);
  let response = await tryToReadFromStream(bridgeProcess.stdout);
  assert.strictEqual(response,
                     'Content-Length: 14\r\n' +
                     '\r\n' +
                     '{"result": {}}');

  await sendToBridgeProcess(bridgeProcess, buildJSONRPCMessage('{"ignored": "message"}'));
  server = startStubServer(9001, [
    { status: 200, body: '{"response": "ok"}' },
  ]);
  await waitForNextRequest(server);

  assert.deepStrictEqual(server.receivedRequests, [
    { method: 'POST', url: '/dragon/lsp', body: '{"method": "initialize"}' },
  ]);
  response = await tryToReadFromStream(bridgeProcess.stdout);
  // Don't deliver initialized response again
  assert.strictEqual(response, null);
});
