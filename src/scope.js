/* jshint globalstrict: true */
'use strict';

//function will be assigned as initial last value of every watcher
function initWatchVal(){}

function Scope(){
    //$$ for private variables in angualar
    this.$$watchers = [];
}

Scope.prototype.$watch = function(watchFn, listenerFn){
    var watcher = {
        watchFn: watchFn,
        listenerFn: listenerFn || function(){},
        last: initWatchVal
    };
    this.$$watchers.push(watcher);
};

//digest trough watches once and return dirty if some watch return new value
Scope.prototype.$$digestOnce = function(){
    //self has this of scope
    var self = this;
    var newValue, oldValue, dirty;
    _.forEach(this.$$watchers, function(watcher){
        newValue = watcher.watchFn(self);
        //first time $digest is called oldValue will be undefined
        oldValue = watcher.last;
        if(newValue !== oldValue){
            //here we add last property to the watcher object and assign it new value
            watcher.last = newValue;
            watcher.listenerFn(newValue, 
                oldValue===initWatchVal ? newValue: oldValue, 
                self);
            dirty = true;
        }
    });
    return dirty;
};

//call $$digestOnce until dirty is true
Scope.prototype.$digest = function(){
    var dirty;
    do{
        dirty = this.$$digestOnce();
    }while(dirty);
};