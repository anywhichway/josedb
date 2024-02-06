function forward([base,...instances],{chain=false}={}) {
    let {target,forwardingMap={}} = base;
    if(!target || typeof target !== 'object') throw new Error('Forward error - base target is not an object');
    base = target;
    instances.forEach((instance,i) => {
        let {target,forwardingMap,name=target.constructor.name} = instance;
        if(!target || typeof target !== 'object') throw new Error(`Forward error - target ${i} is not an object`);
        if(target===base) throw new Error(`Forward error - circular dependency, target ${i} is the same as base`);
        Object.defineProperty(base, name, {get() { return target; }});
    })
    if(chain && instances.length>1) {
        forward(instances,{chain});
    }
    const forwarded = {};
    Object.defineProperty(base, 'forward', {
        get() {
            return new Proxy(forwarded, {
                get(target, property) {
                    let value = Reflect.get(base, property),
                        type = typeof value;
                    if(type!=="undefined" && type!=="function") return value;
                    const start = typeof value.index==="number" ? value.index : 0;
                    for(let i=start;i<instances.length;i++) {
                        const target = instances[i].target;
                        if(instances[i].forwardingMap) {
                            forwardingMap = instances[i].forwardingMap;
                        }
                        if(property in forwardingMap) property = forwardingMap[property];
                        if(typeof target[property] === 'function') {
                            forwarded[property] = (...args) => {
                                forwarded[property].index = i+1;
                                return target[property].apply(target,args);
                            }
                            return forwarded[property];
                        }
                    }
                }
            });
        }
    });
    return base;
}

export {forward as default,forward}