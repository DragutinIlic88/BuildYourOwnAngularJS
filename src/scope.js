/* jshint globalstrict: true */
"use strict";

//function will be assigned as initial last value of every watcher
function initWatchVal() {}

function Scope() {
  //$$ for private variables in angualar
  this.$$watchers = [];
  this.$$lastDirtyWatch = null; //for short-circuiting optimization
  this.$$asyncQueue = []; //for storing $evalAsync jobs that have been scheduled
}

Scope.prototype.$$areEqual = function(newValue, oldValue, valueEq){
    if(valueEq){
        return _.isEqual(newValue, oldValue);
    }else {
        return newValue === oldValue ||
          (typeof newValue === 'number' && typeof oldValue === 'number' && 
          isNaN(newValue) && isNaN(oldValue));
    }
};

//creates new watcher and push it in $$watchers array
Scope.prototype.$watch = function(watchFn, listenerFn, valueEq) {
  var watcher = {
    watchFn: watchFn,
    listenerFn: listenerFn || function() {},
    valueEq: !!valueEq, //coercing variable to a real booolean by negating it twice
    last: initWatchVal
  };
  this.$$watchers.push(watcher);
  //disabling optimazition in case that listener of some watch add another watch
  this.$$lastDirtyWatch = null;
};

//digest trough watches once and return dirty if some watch return new value
Scope.prototype.$$digestOnce = function() {
  //self has this of scope
  var self = this;
  var newValue, oldValue, dirty;
  _.forEach(this.$$watchers, function(watcher) {
    newValue = watcher.watchFn(self);
    //first time $digest is called oldValue will be undefined
    oldValue = watcher.last;
    if (!self.$$areEqual(newValue,oldValue,watcher.valueEq)) {
      //we now know which is last dirty watcher
      self.$$lastDirtyWatch = watcher;
      //here we add last property to the watcher object and assign it new value
      watcher.last = (watcher.valueEq ? _.cloneDeep(newValue) : newValue);
      watcher.listenerFn(
        newValue,
        oldValue === initWatchVal ? newValue : oldValue,
        self
      );
      dirty = true;
    } else if (self.$$lastDirtyWatch === watcher) {
      return false;
    }
  });
  return dirty;
};

//call $$digestOnce until dirty is true
Scope.prototype.$digest = function() {
  var ttl = 10; //time to live is 10 iteration
  var dirty;
  this.$$lastDirtyWatch = null;
  do {
    while(this.$$asyncQueue.length){
      var asyncTask = this.$$asyncQueue.shift();
      asyncTask.scope.$eval(asyncTask.expression);
    }
    dirty = this.$$digestOnce();
    if (dirty && !(ttl--)) {
      throw "10 digest iterations reached";
    }
  } while (dirty);
};

//$eval function lets you execute some code in the context of a scope
//$eval represent building block for $apply
Scope.prototype.$eval = function(expr, locals){
  return expr(this, locals);
};

//$apply is good way to integrate external libraries to Angular
//it executes function passed as argument with $eval and then run digest cycle
//integrating code to the "Angular lifecycle" using $apply
Scope.prototype.$apply = function(expr) {
  try{
    return this.$eval(expr);
  }finally {
    this.$digest();
  }
};

//function whice deffer expr execution but guarantee that it will be executed 
//before end of digest cycle
Scope.prototype.$evalAsync = function(expr){
  //we explicitly store current scope because of scope inheritance
  this.$$asyncQueue.push({scope: this, expression: expr});
};
