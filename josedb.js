import forward from "./forward.js";

function bytesToArrayBuffer(bytes) {
    const bytesAsArrayBuffer = new ArrayBuffer(bytes.length);
    const bytesUint8 = new Uint8Array(bytesAsArrayBuffer);
    bytesUint8.set(bytes);
    return bytesAsArrayBuffer;
}

const saltBuffer = bytesToArrayBuffer([
    89, 113, 135, 234, 168, 204, 21, 36, 55, 93, 1, 132, 242, 242, 192, 156,
]);

function getKeyMaterial(password) {
    return window.crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"],
    );
}

function getKey(keyMaterial, salt) {
    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["wrapKey", "unwrapKey"],
    );
}
async function sha256(str) {
    const array = new TextEncoder("utf-8").encode(str)
    return crypto.subtle.digest("SHA-256", array)
        .then((hashBuffer) => {
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => ('00' + b.toString(16)).slice(-2)).join('')
        })
}

class JOSEDb {

    static create = async ({jose,interactive,signingAlgorithm="ES256",password,signingKeys,encryptionOptions={alg:"RSA-OAEP-256",enc:"A256GCM"},encryptionKeys,issuerId,constructors=new Map(),forwardTo}={}) => {
        encryptionOptions.alg||="RSA-OAEP-256";
        encryptionOptions.enc||="A256GCM";
        const hadPassword = !!password;
        password ||= await crypto.randomUUID();
        const instance = new JOSEDb({jose,signingAlgorithm,password,signingKeys,encryptionOptions,encryptionKeys,issuerId,constructors,forwardTo});
        password = password ? new TextEncoder().encode(await sha256(password)) : password;
        let hadSigningKeys,
            hadEncryptionKeys;
        if(hadPassword) {
            if(!signingKeys) {
                if (interactive) {
                    password = await instance.interactive(interactive,password);
                    signingKeys = instance.signingKeys;
                    encryptionKeys = instance.encryptionKeys;
                }
                if(!signingKeys) {
                    signingKeys = await instance.get("signingKeys");
                    if (signingKeys) {
                        hadSigningKeys = true;
                        signingKeys = await instance.unwrapKeys(signingKeys, password, signingAlgorithm);
                    } else {
                        signingKeys = await jose.generateKeyPair(signingAlgorithm, {extractable: true});
                    }
                    instance.signingKeys = signingKeys;
                }
            }
            if(!encryptionKeys) {
                let encryptionKeys = await instance.get("encryptionKeys");
                if (encryptionKeys) {
                    hadEncryptionKeys = true;
                    encryptionKeys = await instance.unwrapKeys(encryptionKeys, password, encryptionOptions.alg);
                } else {
                    encryptionKeys = await jose.generateKeyPair(encryptionOptions.alg ||= "RSA-OAEP-256", {extractable: true});
                }
                instance.encryptionKeys = encryptionKeys;
            }
        } else {
            if(!signingKeys) {
                if(interactive) {
                    password = await instance.interactive(interactive);
                    signingKeys = instance.signingKeys;
                    encryptionKeys = instance.encryptionKeys;
                } if (!signingKeys) {
                    instance.signingKeys = await instance.get("signingKeys");
                }
                if(typeof instance.signingKeys) {
                    hadSigningKeys = true;
                    instance.signingKeys = typeof instance.signingKeys==="string" ? await instance.unwrapKeys(instance.signingKeys,password,signingAlgorithm) : instance.signingKeys;
                } else {
                    instance.signingKeys = await jose.generateKeyPair(signingAlgorithm, {extractable: true});
                }
            }
            if(!encryptionKeys) {
                instance.encryptionKeys = await instance.get("encryptionKeys");
                if(instance.encryptionKeys) {
                    hadEncryptionKeys = true;
                    instance.encryptionKeys = typeof instance.encryptionKeys === "string" ? await instance.unwrapKeys(instance.encryptionKeys,password,encryptionOptions.alg) :instance.encryptionKeys;
                } else {
                    instance.encryptionKeys = await jose.generateKeyPair(encryptionOptions.alg,{extractable:true});
                }
            }

        }
        if(!hadSigningKeys) {
            await instance.set("signingKeys",await instance.wrapKeys(instance.signingKeys,password),{encrypt:false,sign:false});
        }
        if(!hadEncryptionKeys) {
            await instance.set("encryptionKeys",await instance.wrapKeys(instance.encryptionKeys,password),{encrypt:false,sign:false});
        }
        return instance;
    }
    constructor({jose,signingAlgorithm="ES256",signingKeys,encryptionOptions={alg:"RSA-OAEP-256",enc:"A256GCM"},encryptionKeys,issuerId,constructors=new Map(),forwardTo}={}) {
        encryptionOptions.alg||="RSA-OAEP-256";
        encryptionOptions.enc||="A256GCM";
        this.jose = jose;
        this.issuerId = issuerId;
        this.signingAlgorithm = signingAlgorithm;
        this.signingKeys = signingKeys;
        this.encryptionOptions = encryptionOptions;
        this.encryptionKeys = encryptionKeys;
        this.constructors = constructors;
        forward([{target:this},...forwardTo]);
    }

    async decrypt(value,{privateKey}={}) {
        if(this.isEncrypted(value)) {
            privateKey ||= this.encryptionKeys.privateKey;
            if(!privateKey) throw new Error("decrypt requires a privateKey");
            const {jwe} = value,
                {plaintext} = await this.jose.compactDecrypt(jwe,privateKey);
            return JSON.parse(new TextDecoder().decode(plaintext));
        }
        return value;
    }

    async encrypt(value,{audience,publicKey,encryptionOptions}={}) {
        audience ||= this.issuerId;
        publicKey ||= this.encryptionKeys?.publicKey;
        encryptionOptions ||= this.encryptionOptions;
        if(!publicKey || !encryptionOptions) throw new Error("encrypt requires a publicKey and encryptionOptions");
        const text = new TextEncoder().encode(JSON.stringify(value)),
            jwe = await new this.jose.CompactEncrypt(text)
                .setProtectedHeader(encryptionOptions)
                .encrypt(publicKey),
            encrypted = {
                jwe,
                type: "EncryptedData"
            };
        if(audience) {
            encrypted.audience = audience;
        }
        return encrypted;
    }

    async exportKeys({password,encrypt,interactive}={}) {
        const clearText = password;
        password = typeof password === "string" ? new TextEncoder().encode(await sha256(password)) : password;
        const exported = {
            signingAlgorithm: this.signingAlgorithm,
            encryptionOptions: this.encryptionOptions,
            keys: {
                signingKeys: encrypt ? await this.wrapKeys(this.signingKeys,password) : {
                    privateKey: await this.jose.exportPKCS8(this.signingKeys.privateKey),
                    publicKey: await this.jose.exportSPKI(this.signingKeys.publicKey)
                },
                encryptionKeys: encrypt ? await this.wrapKeys(this.encryptionKeys,password) :{
                    privateKey: await this.jose.exportPKCS8(this.encryptionKeys.privateKey),
                    publicKey: await this.jose.exportSPKI(this.encryptionKeys.publicKey)
                }
            }
        }
        if(password && !encrypt) {
            exported.password = clearText;
        }
        if(interactive) {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([JSON.stringify(exported,null,2)],{type:"application/json"}));
            a.download = "keys.json";
            a.click();
        }
        return exported;
    }

    async get(key,options={}) {
        let {metadataKey,as,...rest} = options,
            {audience=this.issuerId,privateKey=this.encryptionKeys?.privateKey} = as||{},
            value = await this.forward.get(key,{...rest}),
            wasEncrypted;
        if(!value || typeof value!=="object") return value;
        if(value.type==="EncryptionEnvelope") {
            value = value.audience[audience];
            wasEncrypted = true;
        }
        if(value) {
            value = await this.verify(await this.decrypt(value,{privateKey}),{metadataKey});
            if(value && typeof value==="object") {
                const ctor = this.constructors.get(value.type),
                    metadata = value[metadataKey];
                if (ctor) {
                    value = Object.assign(Object.create(ctor.prototype), value);
                    Object.defineProperty(value, "constructor", {value: ctor, writable: true, configurable: true});
                    if(metadata) {
                        Object.defineProperty(value,metadataKey,{value:metadata,configurable:true});
                    }
                    delete value.type;
                }
            }
            if(wasEncrypted && metadataKey && value[metadataKey]) {
               value[metadataKey].audience = audience;
            }
        }
        return value;
    }
    async has(key) {
        const value = await this.forward.get(key);
        return !!value;
    }

    async importKeys({password,encrypted,signingAlgorithm,encryptionOptions,keys}={}) {
        let {signingKeys,encryptionKeys} = keys;
        password = typeof password === "string" ? new TextEncoder().encode(await sha256(password)) : password;
        this.signingAlgorithm = signingAlgorithm;
        this.encryptionOptions = encryptionOptions;
        // use jose to import PEMs
        if(encrypted) {
            signingKeys = await this.unwrapKeys(signingKeys,password,signingAlgorithm);
            encryptionKeys = await this.unwrapKeys(encryptionKeys,password,encryptionOptions.alg);
        } else {
            // use jose to import PEMs
            signingKeys = {
                privateKey: await this.jose.importPKCS8(signingKeys.privateKey,signingAlgorithm,{extractable:true}),
                publicKey: await this.jose.importSPKI(signingKeys.publicKey,signingAlgorithm,{extractable:true})
            };
            encryptionKeys = {
                privateKey: await this.jose.importPKCS8(encryptionKeys.privateKey,encryptionOptions.alg,{extractable:true}),
                publicKey: await this.jose.importSPKI(encryptionKeys.publicKey,encryptionOptions.alg,{extractable:true})
            };
        }
        this.signingKeys = signingKeys;
        this.encryptionKeys = encryptionKeys;
        await this.set("signingKeys",await this.wrapKeys(signingKeys,password),{encrypt:false,sign:false});
        await this.set("encryptionKeys",await this.wrapKeys(encryptionKeys,password),{encrypt:false,sign:false});
    }

    async interactive(selector,password) {
        return new Promise(async (resolve,reject) => {
            const dialog = document.createElement("dialog");
            dialog.setAttribute("class","example.html");
            dialog.addEventListener("click",(event) => {
                if(event.target.className.includes("password")) {
                    if(event.target.previousElementSibling.type==="text") event.target.previousElementSibling.type = "password";
                    else event.target.previousElementSibling.type = "text";
                }
            })
            document.querySelector(selector).appendChild(dialog);
            if(!await this.has("encryptionKeys") && !await this.has("signingKeys")) {
                dialog.innerHTML = `
                    <p>It looks like you are starting from scratch. You will need to create or load keys.</p>
                    <p style="text-align: center">
                    <button id="createKeys" onclick="createKeysForm()">Create Keys</button>
                    <button id="loadKeys" onclick="loadKeysForm()">Load Keys</button>
                    </p>
                `;
                dialog.showModal();
            } else {
                if(password) {
                    resolve(password);
                } else {
                    dialog.innerHTML =
                        `<form id="passwordForm">
                            <label for="password">Password </label>
                            <div>
                            <input type="password" id="password" name="password" required><span class="password"></span>
                            </div>
                            <p style="text-align: center"><button type="submit">Login</button></p>
                        </form>`;
                        dialog.querySelector("#passwordForm").onsubmit = async (e) => {
                            e.preventDefault();
                            resolve(dialog.querySelector("#password").value);
                            dialog.close();
                            dialog.remove();
                        };
                    dialog.showModal();
                    //resolve(new TextEncoder().encode(await sha256(password)));
                }
            }
            window.createKeysForm = () => {
                dialog.innerHTML = `
                <form id="createKeysForm">
                    <label for="password">Password</label>
                    <div>
                        <input type="password" id="password" name="password" required><span class="password"></span>
                    </div>
                    <label for="passwordConfirm">Confirm Password</label>
                    <input type="password" id="passwordConfirm" name="passwordConfirm" required>
                    Export Keys: <input type="radio" name="exportFormat" value="encrypted" checked> Encrypted
                    <input type="radio" name="exportFormat" value="clear"> Clear Text With Password
                    <input type="radio" name="exportFormat" value="none"> Do Not Export
                    <p style="text-align: center"><button type="submit">Create Keys</button></p>
                </form>
                <p>
                    <strong>Note:</strong> When exported, keys can be found in a file named "keys.json" in your download folder. 
                    It is suggested you store them on a thumb drive or other secure location and delete them from your downloads folder. 
                    Do not keep your keys soley on the same device where you are using this application.
                    If you exported keys as clear text do not keep them on a public device. 
                </p>
                <p>
                    <strong>Warning:</strong> If you forget your password, you will not be able to access your keys unless they have been exported as Clear Text. If you can't
                    access your keys you will not be able to sign or verify signed data or read any encrypted data. Make sure you remember it!
                </p>
                <p>
                    <strong>Warning:</strong> If you lose your keys, you will not be able to sign or verify signed data or read any encrypted data.
                    It is suggested you export your keys. For convenience, clear text exports contain your password, since the keys are already insecure when in clear text.
                </p>
            `;
                dialog.querySelector("#createKeysForm").onsubmit = async (e) => {
                    e.preventDefault();
                    const password = dialog.querySelector("#password").value;
                    this.signingKeys = await this.jose.generateKeyPair(this.signingAlgorithm, {extractable: true});
                    this.encryptionKeys = await this.jose.generateKeyPair(this.encryptionOptions.alg ||= "RSA-OAEP-256", {extractable: true})
                    const exportFormat = [...dialog.querySelectorAll('[name="exportFormat"]')].find(el => el.checked).value;
                    if(exportFormat!=="none") {
                        await this.exportKeys({password,interactive:true,encrypt:exportFormat==="encrypted"});
                    }
                    dialog.close();
                    dialog.remove();
                    resolve(password);
                }
            }
            window.loadKeysForm = () => {
                dialog.innerHTML = `
                <form id="loadKeysForm">
                    <label for="keys">Keys</label>
                    <input type="file" id="keys" name="keys" accept="application/json" required>
                    <p style="text-align: center"><button type="submit">Load Keys</button></p>
                </form>
            `;
                dialog.querySelector("#loadKeysForm").onsubmit = async (e) => {
                    e.preventDefault();
                    const file = dialog.querySelector("#keys").files[0],
                        reader = new FileReader();
                    reader.onload = async () => {
                        const keySpec = JSON.parse(reader.result);
                        let encrypted = false,
                            password;
                        if(keySpec.password) {
                            dialog.innerHTML = `
                            <form id="passwordForm">
                                <label for="password">Password loaded from clear text file. (OK to change at this time)</label>
                                <div>
                                    <input type="password" id="password" name="password" value="${keySpec.password||''}" required><span class="password"></span>
                                </div>
                                <p style="text-align: center"><button type="submit">Ok</button></p>
                            </form>`;
                            dialog.querySelector("#passwordForm").onsubmit = async (e) => {
                                e.preventDefault();
                                password = dialog.querySelector("#password").value;
                                if(password!==keySpec.password) {
                                    const encrypt = confirm(`Password has been changed to ${password}. Make sure you remember it! Keys must MUST be re-exported. Click OK to export in encrypted form. Click Cancel to export in plain text.`);
                                    await this.exportKeys({password,interactive:true,encrypt})
                                }
                                await this.importKeys({password,...keySpec}); //encrypted,
                                resolve(password);
                                dialog.close();
                                dialog.remove();
                            };
                        } else {
                            dialog.innerHTML = `
                            <form id="passwordForm">
                                <label for="password">Keys are encrypted. Enter the password to decrypt.</label>
                                <div>
                                    <input type="password" id="password" name="password" value="${keySpec.password||''}" required><span class="password"></span>
                                </div>
                                <p style="text-align: center"><button type="submit">Decrypt Keys</button></p>
                            </form>`;
                            dialog.querySelector("#passwordForm").onsubmit = async (e) => {
                                e.preventDefault();
                                password = dialog.querySelector("#password").value;
                                await this.importKeys({password,encrypted:true,...keySpec});
                                resolve(password);
                                dialog.close();
                                dialog.remove();
                            };
                        }
                    }
                    reader.readAsText(file);
                }
            }
        })

    }

    isEncrypted(value) {
        return typeof value.jwe==="string" && typeof value.audience==="string" && value.type==="EncryptedData";
    }

    isSigned(value) {
        return typeof value.jwt==="string" && typeof value.issuer==="string" && typeof value.audience==="string" && typeof value.publicKeyPEM==="string";
    }

    async set(key, value,options={}) {
        let {encrypt,sign,audience,expirationTime,notBefore,subject,metadata,metadataKey,expose=[],...rest} = options;
        if(encrypt!==false) encrypt = true;
        if(sign!==false) sign = true;
        audience ||= {
            [this.issuerId]: this.encryptionKeys?.publicKey
        };
        if(value && typeof value==="object") {
            if(metadataKey) {
                metadata ||= value[metadataKey];
            }
            audience ||= this.issuerId;
            const ctor = value.constructor;
            value = {...value,type:ctor.name};
            if (value.type !== "Object") this.constructors.set(value.type, ctor);
        }
        const signingAudience = audience && typeof audience==="object" ? "*" : audience;
        value = sign ? await this.sign(value, {key,audience:signingAudience,expirationTime,notBefore,subject,metadata,expose}) : value;
        expirationTime ||= value.expirationTime;
        if(encrypt && audience && typeof audience==="object") {
            const envelope = {
                audience: {},
                type: "EncryptionEnvelope"
            }
            if(expose.includes("key")) envelope.key = key;
            if(expose.includes("expirationTime")) envelope.expirationTime = expirationTime;
            if(expose.includes("notBefore")) envelope.notBefore = notBefore;
            if(expose.includes("subject")) envelope.subject = subject;
            for(const [aud,publicKey] of Object.entries(audience)) {
                envelope.audience[aud] = await this.encrypt(value,{publicKey});
            }
            value = envelope;
        }
        return this.forward.set(key,value,{...rest});
    }

    async sign(value,{key,issuer,audience="*",issuedAt=Date.now(),expirationTime=8640000000000000,notBefore,subject,signingAlgorithm,signingKeys,metadata={},expose=[]}={}) {
        issuer ||= this.issuerId;
        signingAlgorithm ||= this.signingAlgorithm;
        signingKeys ||= this.signingKeys;
        const {privateKey,publicKey} = signingKeys,
            alg = signingAlgorithm,
            jwt = new this.jose.SignJWT({data:value,key,...metadata})
                .setProtectedHeader({alg})
                .setIssuedAt(issuedAt)
                .setIssuer(issuer)
                .setAudience(audience)
                .setExpirationTime(expirationTime);
        if(notBefore) jwt.setNotBefore(notBefore);
        if(subject) jwt.setSubject(subject);
            const signed = {
                jwt: await jwt.sign(privateKey),
                issuer,
                audience,
                publicKeyPEM: await this.jose.exportSPKI(publicKey),
                type: "SignedData"
            };
            if(subject) signed.subject = subject;
            if(expose.includes("issuedAt")) signed.issuedAt = new Date(issuedAt);
            if(expose.includes("expirationTime")) signed.expirationTime = new Date(expirationTime);
            if(expose.includes("notBefore") && notBefore) signed.notBefore = new Date(notBefore);
        return signed;
    }

    async remove(key,options={}) {
        return this.forward.remove(key,options);
    }

    async unwrapKeys(keys,password,algorithm) {
        password = typeof password === "string" ? new TextEncoder().encode(await sha256(password)) : password;
        const {payload} = await this.jose.jwtDecrypt(keys,password,{issuer:this.issuerId,audience:this.issuerId});
        // import the keys from PEM formats
        return {
            privateKey: await this.jose.importPKCS8(payload.privateKey,algorithm,{extractable:true}),
            publicKey: await this.jose.importSPKI(payload.publicKey,algorithm,{extractable:true})
        };
    }

    validatePassword(password) {
        this.validatePassword.requirements = "at least 8 characters";
        return password && password.length>=8;
    }

    async verify(value,{metadataKey}={}) {
        if(this.isSigned(value)) {
            const {publicKeyPEM,issuer,audience,subject,jwt} = value,
                publicKey = await this.jose.importSPKI(publicKeyPEM,this.signingAlgorithm);
            try {
                const {payload} = await this.jose.jwtVerify(jwt, publicKey, {issuer, audience});
                if(payload.exp<=Date.now()) {
                    if(payload.key) await this.forward.remove(payload.key);
                    return;
                }
                if(payload.sub!==subject) throw new Error(`subject ${subject} !== payload.sub ${payload.sub}`);
                if(metadataKey && payload.data && typeof payload.data==="object") {
                    const meta = {};
                    Object.entries({
                        iat:"issuedAt",
                        exp:"expirationTime",
                        iss:"issuer",
                        aud:"audience",
                        nbf:"notBefore",
                        sub:"subject",
                        key:"key"
                    }).forEach(([key,property]) => {
                        if (key in payload) {
                            meta[property] = payload[key]
                        }
                    });
                    Object.defineProperty(payload.data,metadataKey,{value:meta});
                }
                return payload.data;
            } catch(e) {
                if(e.message.includes("nbf")) return;
                throw e;
            }
        }
        return value;
    }

    async wrapKeys(keys,password) {
        password = typeof password === "string" ? new TextEncoder().encode(await sha256(password)) : password;
        const exported =  {
            privateKey: await this.jose.exportPKCS8(keys.privateKey),
            publicKey: await this.jose.exportSPKI(keys.publicKey)
        }
        return new this.jose.EncryptJWT(exported)
            .setProtectedHeader({alg: 'dir', enc: 'A256CBC-HS512'})
            .setIssuedAt()
            .setIssuer(this.issuerId)
            .setAudience(this.issuerId)
            .encrypt(password)
    }
}

export {JOSEDb as default,JOSEDb};