const patchIdbKv = (IdbKvStore) => {
    IdbKvStore.prototype.get = function (key) {
        return new Promise((resolve,reject) => {
            this.transaction('readonly').get(key,(err,value) => {
                if(err) reject(err);
                else resolve(value);
            });
        });
    }
    IdbKvStore.prototype.set = function (key,value) {
        return new Promise((resolve,reject) => {
            this.transaction('readwrite').set(key,value,(err,value) => {
                if(err) reject(err);
                else resolve(value);
            });
        });
    }
    IdbKvStore.prototype.remove = function (key) {
        return new Promise((resolve,reject) => {
            this.transaction('readwrite').remove(key,(err,value) => {
                if(err) reject(err);
                else resolve(value);
            });
        });
    }
    return IdbKvStore;
}

export { patchIdbKv, patchIdbKv as default };