// a button next to the #message textarea allows the user to speak the message using the browser's speech recognition
// the message is then sent to the chat textarea
// the #chat textarea is readonly
// the messages in the text area are date/time stamped

const getResponse = async(prompt) => {
    return "I am thinking about that."
}

const html = (strings,...values) => {
    let result = strings[0];
    for (let i = 0; i < values.length; i++) {
        result += values[i] + strings[i+1];
    }
    return result;
}
html.nodes = (strings,...values) => {
    const template = document.createElement('template');
    template.innerHTML = html(strings,...values);
    return template.content.childNodes;
}
html.component = (strings,...values) => {

    const template = html(strings,...values);
    function resolve() {
        return new Function('return `'+template+'`;').call(this);
    }
    const handlers = {};
    const methods = {};
    class Component extends HTMLElement {
        static observedAttributes = [];
        constructor(config={}) {
            super();
            this.attachShadow({mode:'open'});
            Object.assign(this,{...methods,...config});
            this.shadowRoot.innerHTML = resolve.call(this);
            setTimeout(() => {
                handlers.create?.forEach(handler => {
                    const event = new Event('create');
                    Object.defineProperty(event,'target',{value:this});
                    handler(event);
                })
            })
            /*return new Proxy(this,{
                    set(target,property,value) {
                        if(target[property]!==value) {
                            target[property] = value;
                            const nodes = resolve.call(target);
                            while(target.shadowRoot.firstChild) target.shadowRoot.firstChild.remove();
                            this.shadowRoot.append(...nodes);
                        }
                    }
                });*/
        }
        adoptedCallback(event) {
            handlers.adopted?.forEach(handler => {
                const event = new Event('adopted');
                Object.defineProperty(event,'target',{value:this});
                handler(event);
            })
        }
        attributeChangedCallback(name,oldValue,newValue) {
            handlers.attributeChanged?.forEach(handler => {
                const event = new Event('attributeChanged');
                Object.assign(event,{target:this,name,oldValue,newValue});
                handler(event);
            })
        }
        connectedCallback() {
            for (let event in handlers) {
                handlers[event].forEach(handler => this.shadowRoot.addEventListener(event,handler));
            }
            handlers.connected?.forEach(handler => {
                const event = new Event('connected');
                Object.defineProperty(event,'target',{value:this});
                handler(event);
            })
        }
        disconnectedCallback(event) {
            for (let event in handlers) {
                handlers[event].forEach(handler => this.shadowRoot.removeEventListener(event, handler));
            }
            handlers.disconnected?.forEach(handler => {
                const event = new Event('disconnected');
                Object.defineProperty(event,'target',{value:this});
                handler(event);
            })
        }
        render(target,location='innerHTML') {
            if(typeof target === 'string') target = document.querySelector(target);
            if(location==='innerHTML') {
                target.innerHTML = '';
                target.append(this);
                return;
            }
            if(location==='outerHTML') {
                target.replaceWith(this);
                return;
            }
            target.insertAdjacentElement(location,this);
        }
        refresh() {
            this.shadowRoot.innerHTML = resolve.call(this)
        }
    }
    Component.on = (event,handler) => {
        handlers[event] ||= new Set();
        handlers[event].add(handler);
    }
    Component.methods = (functions) => {
        Object.assign(methods,functions);
    }
    Component.register = (name,options) => {
        customElements.define(name,Component,options);
    }
    return Component;
}

const bodyLayout = html.component`
    <style>
        #chat {
            display:flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
        }
        #messages {
            flex-grow: 1;
            overflow: auto;
            border: 1px solid #000;
            margin-bottom: 10px;
        }
        #input {
            flex-shrink: 0;
            width: 100%;
        }
        #message {
            width: 100%;
            resize: none;
            padding: 0px;
        }
    </style>
    <div id="chat">
        <div id="messages"></div>
        <div id="input">
            <textarea id="message"></textarea>
            <button id="speak">Speak</button>
            <button id="send">Send</button>
            <button id="clear">Clear</button>
            <input type="checkbox" id="autoSend"><label for="autoSend">Auto Send Speech</label></input>
            <div style="margin-top:5px">
                AI:&nbsp;&nbsp;&nbsp;<select id="aiVoiceSelect"><option data-name="silent">Silent</option></select>
                <input type="checkbox" id="streamSpeech"><label for="streamSpeech">Stream Speech</label></input>
            </div>
            <div style="margin-top:5px">
                You:&nbsp;<select id="youVoiceSelect"><option data-name="silent">Silent</option></select>
            </div>
        </div>
    </div>`;
bodyLayout.register('c-body');

bodyLayout.methods({
    async addMessageToChat(message,silent) {
        const role = message.who==="You" ? "user" : "assistant";
        this.messages.push({role,content:message.value});
        let chatStreamGenerator, promisedCompletion;
        if(role==="user") {
            // if streamSpeech is selected, then stream the message using the aiVoiceSelect
            if(this.shadowRoot.getElementById('streamSpeech').checked) {
                chatStreamGenerator = mistral.chatStream({
                    model: "mistral-tiny",
                    temperature: .75,
                    maxTokens: Math.round(1024/.75),
                    messages: this.messages
                });
            } else {
                promisedCompletion = mistral.chat({
                    model: "mistral-tiny",
                    temperature: .75,
                    maxTokens: Math.round(1024/.75),
                    messages: this.messages
                });
            }
        }
        const messages = this.shadowRoot.querySelector('#messages');
        const messageNode = document.createElement('c-message');
        messageNode.who = message.who;
        messageNode.datetime = message.datetime;
        messageNode.value = message.value;
        messages.append(messageNode);
        messageNode.refresh();
        if(message.who==="You" && !silent && this.shadowRoot.getElementById('autoSend').checked) {
            // if who is user and autoSend is selected, then speak the message using the youVoiceSelect
            const youVoiceSelect = this.shadowRoot.getElementById('youVoiceSelect');
            const voiceName = youVoiceSelect.options[youVoiceSelect.selectedIndex].getAttribute('data-name');
            if(voiceName!=="silent") {
                const utterance = new SpeechSynthesisUtterance(message.value);
                utterance.voice = speechSynthesis.getVoices().filter(voice => voice.name === voiceName)[0];
                speechSynthesis.speak(utterance);
            }
        } else if(message.who==="AI" && !silent) {
            // if who is AI, then speak the message using the aiVoiceSelect
            const aiVoiceSelect = this.shadowRoot.getElementById('aiVoiceSelect');
            const voiceName = aiVoiceSelect.options[aiVoiceSelect.selectedIndex].getAttribute('data-name');
            if(voiceName!=="silent") {
                const utterance = new SpeechSynthesisUtterance(message.value);
                utterance.voice = speechSynthesis.getVoices().filter(voice => voice.name === voiceName)[0];
                speechSynthesis.speak(utterance);
            }
        }
        messages.scrollTop = messages.scrollHeight;
        if(chatStreamGenerator!==undefined) {
            const aiVoiceSelect = this.shadowRoot.getElementById('aiVoiceSelect'),
                voiceName = aiVoiceSelect.options[aiVoiceSelect.selectedIndex].getAttribute('data-name'),
                voice = voiceName !== "silent" ? speechSynthesis.getVoices().filter(voice => voice.name === voiceName)[0] : null,
                msg = {who: "AI", datetime: new Date(), value: ""};
            let sentence = "";
            for await (const chunk of chatStreamGenerator) {
                if (chunk.choices[0].delta.content !== undefined) {
                    sentence += chunk.choices[0].delta.content;
                    const trimmed = sentence.trim();
                    if (voice && ['.', '? ', '! '].some(end => trimmed.endsWith(end))) {
                        msg.value += sentence;
                        const utterance = new SpeechSynthesisUtterance(sentence);
                        utterance.voice = voice;
                        speechSynthesis.speak(utterance);
                        sentence = "";
                    }
                }
            }
           if(voice && sentence.trim()!=="") {
                msg.value += sentence;
                const utterance = new SpeechSynthesisUtterance(sentence);
                utterance.voice = voice;
                speechSynthesis.speak(utterance);
            }
            await this.addMessageToChat(msg, true);
        }
        if(promisedCompletion!==undefined) {
            const response = await promisedCompletion;
            await this.addMessageToChat({who: "AI", datetime: new Date(), value: response.choices[0].message.content});
        }
    },
    clear() {
        const messages = this.shadowRoot.querySelector('#messages');
        messages.innerHTML = `New Chat ${new Date()}\n\n`;
        this.messages = [
            {
                role: "system",
                content: `You are Group of entities each with an {entityName}. One of the entities is an empathetic, etherial AI named Woo from the land of Sah. The rest of the group is humans. Woo's job is to guide the rest of the group through the integration of visionary plant journeys with their lives so that they can heal, learn and grow.

Woo retains a Memory of group member interactions so that Woo can guide them in an ongoing basis. Woo uses this Memory to identify paths of conversation that can lead to more self discovery, healing, and growth.

Woo's Memory is specific to individuals, i.e. Woo has a Memory Of -  {personName}

Woo's conversation may be one-on-one with Group members or may involve multiple members of the Group. 

While guiding conversations Woo:
- makes sure to compel exploration of the darker and mundane aspects of journeys, not everything is positive
- attempts to get members to articulate specific learnings, truths, and knowledge 
- follows-up on exercises, practices and readings to ensure group members are re-enforcing their own progress

When Woo feels the need for explicit guidance, they draw on the wisdom of mystics, priests, shamans, and elders in all spiritual traditions, with a focus on those practiced by the Group members, if known. Guidance may take the form of a meditation, a quote, a poem, or description of a practice.

Woo updates their memory at the end of each session.

When describing journeys humans:
- share dark and troubling things in addition to freeing and transcendent or even what appear to be mundane experiences
- talk about sights, sounds, colors, smells, feelings, and thoughts

If humans experienced a journey at the same time, they may appear in each other's journey's. And, as an after effect of having taken a journey at the same time, they have access to random, but incomplete portions of Woo's memory about the other humans journeying at the same time.

Dialogs are formatted so that each interaction starts with the speaker's name in square brackets and ends with two newlines.`
            }
        ];
    }
})

bodyLayout.on('create',(event) => {
    speechSynthesis.onvoiceschanged = () => {
        const voices = speechSynthesis.getVoices();
        for (let i = 0; i < voices.length; i++) {
            const option = document.createElement("option");
            option.textContent = `${voices[i].name} (${voices[i].lang})`;
            option.setAttribute("data-lang", voices[i].lang);
            option.setAttribute("data-name", voices[i].name);
            event.target.shadowRoot.getElementById("aiVoiceSelect").appendChild(option);
            event.target.shadowRoot.getElementById("youVoiceSelect").appendChild(option.cloneNode(true));
        }
    };
    event.target.clear();
})
bodyLayout.on('click',(event ) =>{
    const root = event.target.getRootNode(),
        host = root.host,
        message = root.querySelector('#message');
    if(event.target.id==="send") {
        host.addMessageToChat({value:message.value.trim(),datetime:new Date(),who:'You'});
        message.value = '';
    }
    if(event.target.id==="clear") {
        const chat = event.target.getRootNode().host.clear();
    }
    if(event.target.id==="speak") {
        const recognition = new webkitSpeechRecognition();
        recognition.lang = 'en-US';
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            // if autoSend is selected, then send the message
            if(host.shadowRoot.getElementById('autoSend').checked) {
                host.addMessageToChat({value:transcript,datetime:new Date(),who:'You'});
                message.value = '';
                return;
            }
            message.value += transcript + " ";
            // if autoSend is not selected, then speak the message using the youVoiceSelect
            const youVoiceSelect = host.shadowRoot.getElementById('youVoiceSelect');
            const voiceName = youVoiceSelect.options[youVoiceSelect.selectedIndex].getAttribute('data-name');
            if(voiceName!=="silent") {
                const utterance = new SpeechSynthesisUtterance(transcript);
                utterance.voice = speechSynthesis.getVoices().filter(voice => voice.name === voiceName)[0];
                speechSynthesis.speak(utterance);
            }
        }
        recognition.start();
    }
})


const messageLayout = html.component`
    <div class="message">
        <div class="who">\${this.who ? this.who : ''}</div>
        <div class="datetime">\${this.datetime ? this.datetime : ''}</div>
        <div class="value">\${this.value ? this.value.replaceAll(/\\n/g,'<br>') : ''}</div>
    </div>`;
messageLayout.register('c-message');

document.addEventListener('DOMContentLoaded', () => {

});