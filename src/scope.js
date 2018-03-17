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
    _.forEach(this.$$watchers, function(watcher){
        watcher.watchFn(self);
        watcher.listenerFn();
    });
};