/* jshint globalstrict: true */
'use strict';

function Scope(){
    //$$ for private variables in angualar
    this.$$watchers = [];
}

Scope.prototype.$watch = function(watchFn, listenerFn){
    var watcher = {
        watchFn: watchFn,
        listenerFn: listenerFn
    };
    this.$$watchers.push(watcher);
};

Scope.prototype.$digest = function(){
    //self has this of scope
    var self = this;
    var newValue, oldValue;
    _.forEach(this.$$watchers, function(watcher){
        newValue = watcher.watchFn(self);
        //first time $digest is called oldValue will be undefined
        oldValue = watcher.last;
        if(newValue !== oldValue){
            //here we add last property to the watcher object and assign it new value
            watcher.last = newValue;
            watcher.listenerFn(newValue, oldValue, self);
        }
    });
};