# JOSEDb
JSON Object Signing and Encryption Database

## Introduction

`JOSEDb` leverages [JSON Object Signing and Encryption](https://jose.readthedocs.io/en/latest/) (JOSE) standards to 
provide a secure and flexible encrypted and signed kev-value store for JSON objects.

By default, all JSON values stored via `JOSEDb` are the claims on JWE's and JWTs. They are encrypted and signed with the 
current user as both the issuer and audience. This provides a default high level of security for sensitive data stored 
on disk, since it is all private to the logged-in user of a database.

The primary focus of `JOSEDb` is providing security on client machines using [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), 
although it can also be used on a server.

Multiple non-user audiences can be set for data and distinct encrypted sub-packages are created/bundled in an `EncryptionEnvelope`
using the public key of each audience member.

A `subject`, `issuedAt`, `expirationTime`, and `notBefore` time can be optionally exposed publically on an  `EncryptionEnvelope` 
to facilitate distribution of the data, even though they are not an intrinsic part of the encrypted JWE standard.

For signed data, `issuer` and `audience` are public by default to support interoperability with other databases. It is also possible 
to expose the `subject`, `issuedAt`, `expirationTime`, and `notBefore` time of signed data outside the verification envelope 
but inside and `EncryptionEnvelope`.

Encryption it treated to be of higher importance than signing, i.e. signed data is wrapped by encryption. This ensures the 
security of `subject`, `issuedAt`, `expirationTime`, and `notBefore` time of signed data if there is a decision to not expose 
it on the `EncryptionEnvelope`.

If constructors are passed to a `JOSEDb` when it is created, then the database will automatically return instances of the 
same objects that are saved. The database will also "learn" constructors at runtime and will be able to return instances 
of objects that were saved before the constructor was passed to the database so long as the database is not shutdown.

Finally, `JOSEDb` provides a metadata mechanism to store additional information about JSON objects on any key a developer 
may choose.

## Installation

You must load the `jose` library before using `josedb` at runtime.

```html
<script type="module">
    import * as jose from 'https://cdn.jsdelivr.net/npm/jose@5.2.0/+esm';
    import JOSEDb from './josedb.js';
    // you can use a different KV store if you want
    import * as _IdbKvStore from 'https://cdn.jsdelivr.net/npm/idb-kv-store/+esm';
    import patchIdbKv from "./patchIdbKv";
    const IdbKvStore = _IdbKvStore.default;
    patchIdbKv(IdbKvStore); // ensure IdbKvStore is using Promise based methods
</script>
```

Or, install `jose` and `josebdb` using NPM and use a bundler like Webpack or Rollup to include it in your project in the 
manner of your choice.

```bash
npm install jose
```

```bash
npm install josedb
```

## Usage

JOSEDb actually just provides a wrapper around any KV store supporting `get`, `set`, and `remove` methods. It is also 
possible to map `put` or `putItem`, and `delete` or `removeItem` if your selected store uses them instead of `set` and 
`remove`. Hence, you can even map `localStorage` for use by JOSEDb.

Our browser examples and testing will use:

- [IDBKVStore](https://github.com/xuset/idb-kv-store)
- the browser [Storage](https://developer.mozilla.org/en-US/docs/Web/API/Storage) and API around [localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).

Our server and NodeJS testing will use:

- [LMDB](https://github.com/kriszyp/lmdb-json).

### About The Documentation

TypeScript like notation is used to make the documentation more precise where necessary. The actual implementation is in JavaScript NOT TypeScript.

### Running Example

There is an example file `example.html` in the root of the project that demonstrates the use of `JOSEDb` with `IDBKVStore`.

Since `JOSEDb` uses encryption and signing, it is necessary to run the example over `https`. You can use the `http-server`,
which is installed as a development dependency of this project, to run the example.

Run the following command from the root of the project to start the server:

```bash
npm run serve
```

Then open your browser and navigate to `http://127.0.0.1:443/example.html`. Note, running over localhost will not work.
And, `http:` is correct due to a nuance of how security works in the browser with `127.0.0.1`.

### Creating A Database

Because creating a database requires the use of asynchronous functions to manage keys, it is necessary to use a static method to create a database.

```html
<script type="module">
    import * as _IDBKVStore from 'https://cdn.jsdelivr.net/npm/idb-kv-store@4.5.0/+esm';
    const IDBKVStore = IDBKVStore.default;
    import * as jose from 'https://cdn.jsdelivr.net/npm/jose@5.2.0/+esm';
    import JOSEDb from './josedb.js';
    // const password = "b6db5b8f-bb3a-4af3-aa90-15ab285c8561";
    // const signingKeys = await jose.generateKeyPair("ES256",{extractable:true}),
    // encryptionKeys = await jose.generateKeyPair("RSA-OAEP",{extractable:true});
    const josedb = await JOSEDb.create({interactive:#keyFormLocation,jose,forwardTo:[new IDBKVStore('jose@somewhere.com')] ,issuer:'jose@somewhere.com",jose});
</script>
```

You can pass some combination of `password` and keys into the `create` method. 

If you do not pass anything and set `interactive` to a CSS selector, then the user will be prompted to enter a password and optionally generate or load
keys from a local file (perhaps a thumbdrive). Keys can be exported as a JSON file containing PEM keys or as a JSON file
containing `JOSE` encrypted keys.

By convention, the database name is the same as the `issuer`. The `issuer` is required for all databases. The `issuer` is used to identify the signer of the data. 
Most people use an email address or the first part of a three part hostname.

`forwardTo` must be at least one element long and must be a KV store that supports `get`, `set`, and `remove` methods or declare a `forwardingMap`.

Here is a `fowardingMap` for `localStorage`:

```javascript
const fowardingMap = {
    get: "getItem",
    set: "setItem",
    remove: "removeItem"
}
const josedb = await JOSEDb.create({interactive:#keyFormLocation,jose,forwardTo:[{target:localStorage,fowardingMap}],issuer:"jose@somewhere.com"});
```

Here is a `fowardingMap` for `lmdb`:

```javascript
const fowardingMap = {
    set: "put"
}
```

The `fowardingMaps` assumes synchronous or asynchronus methods, it does not support callback type implementations.

The abstract forwarding mechanism used by `JOSEDb` This allows you to insert another layer of API abstraction after encryption and signing 
but before the actual store. This is useful for logging, caching, and other purposes.

```javascript
const josedb = await JOSEDb.create({interactive:#keyFormLocation,jose,forwardTo:[{target:myInterfaceImplementation},{target:localStorage,fowardingMap:{get:"getItem",set:"setItem",remove:"removeItem"}}]})
```

The interfaces you forward to can have their own `fowardingMap`. IN the example above it does not and MUST implement `get`, `set`, and `remove` methods.

### Manipulating Data

The `get`, `set`, and `remove` methods of a `JOSEDb` provide arguments beyond those supported by the store receiving the forward; however, they will forward
any `options` you use.

#### set

The `set` method of a `JOSEDb` takes a `key` and a `value` and an optional `options` object.

```javascript
// adds joe, signs the data with both the issuer and audience as joe@somwhere.com
// the data effectively never expires (it is set to the maximumn possible JavaScript time) 
// the data has no not before time
// the data is encrypted with the public key of the issuer
class User {
    constructor(config) {
        Obect.assign(this, config)
    }
}

example.set("user", new Person({name: "joe"})); 
```

The `options` object has the surface:

```typescript
{
    encryption?: boolean true; // if set to false, the data is not encrypted
    signing?: boolean true; // if set to false, the data is not signed
    audience?: string|object; // use * for any audience, or a comma separated list of audiences, or a map of audiences to public keys
    issuer?: string; // the issuer of the data (the signer)
    subject?: string; // the subject of the data
    expirationTime?: number 8639998988400000; // defaults to the maximum possible JavaScript datetime, Tue, 02 Sep 275760 00:00:00 GMT
    notBefore?: number; // the earliest time the data is valid
    metadata?: object; // a map of key value pairs to be stored with the data
    ...any; // any other options are forwarded to the wrapped store
}
```

In addition to the value `false` for `encryption`, using a `string` for the audience value will turn off encryption.
Providing a map for the `audience` will automatically set the signing audience to `*` since JWT's only support a single audience.

#### get

The `get` method of a `JOSEDb` takes a `key` and an optional `options` object.

```javascript
// gets joe
const joe = await example.get("user");
console.log(joe.constructor.name, joe); // writes Person {name:"joe"}
```

The `options` object has the surface:

```typescript
{
    metadataKey: string; // the key for the metadata on the returned object
    ...any; // any other options are forwarded to the wrapped store
}
```

```javascript
// gets joe
const joe = await example.get("user", {metadataKey: "^"});
console.log(joe.constructor.name, joe, joe["^"]); // writes Person {name:"joe"} plus a metadata object
```

The metadata object may include any of the options used to create signed or encrypted tokens such as `issuer`, `audience`, 
`subject`, `issuedAt`, `expirationTime`, and `notBefore` as well as arbitrary key value pairs.

`undefined` is returned by `get` if:

1) the key is not found
2) the current time is out of range for `expirationTime` and `notBefore`
3) the current `issuerId` is not in the audience for an `EncryptionEnvelope`
4) the current signing audience is not "*" or the `issuerId`

An error will throw if the signature is invalid or de-encryption fails due to tampering or a bad key.

# Release History (Reverse Chronological Order)

2024-02-08 0.0.3-b Enhanced documentation.

2024-02-07 0.0.2-b Enhanced documentation. Added start script for `http-server`.

2024-02-06 0.0.1-b BETA Initial public release. Password validation to ensure length, etc. is yet to be implemented.
Unit tests are not yet in place. BETA will be exited when password validation is in place, test coverage exceeds 90%, 
all tests pass and there has been community feedback.
