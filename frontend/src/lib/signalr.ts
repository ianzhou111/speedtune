import * as signalR from '@microsoft/signalr'
import { getToken } from './api'

let _connection: signalR.HubConnection | null = null
// Shared promise so concurrent callers all wait for the same connect attempt
// rather than racing — fixes the React StrictMode double-mount issue where
// the second effect fires while the connection is still in Connecting state.
let _startPromise: Promise<signalR.HubConnection> | null = null

function buildConnection(): signalR.HubConnection {
  const token = getToken()
  return new signalR.HubConnectionBuilder()
    .withUrl('/hub', token ? { accessTokenFactory: () => token } : {})
    .withAutomaticReconnect()
    .configureLogging(signalR.LogLevel.Warning)
    .build()
}

export function startConnection(): Promise<signalR.HubConnection> {
  if (!_connection) _connection = buildConnection()

  // If already connected, resolve immediately
  if (_connection.state === signalR.HubConnectionState.Connected) {
    return Promise.resolve(_connection)
  }

  // If a connect attempt is already in flight, reuse it
  if (_startPromise) return _startPromise

  // Start a new attempt and cache the promise so concurrent callers share it
  _startPromise = _connection.start()
    .then(() => _connection!)
    .finally(() => { _startPromise = null })

  return _startPromise
}

export function stopConnection() {
  _startPromise = null
  _connection?.stop()
  _connection = null
}

/** Force-drop the singleton so the next startConnection() picks up a fresh token. */
export function resetConnection() {
  _startPromise = null
  _connection?.stop()
  _connection = null
}
