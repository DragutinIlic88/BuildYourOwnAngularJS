/* jshint globalstrict: true */
"use strict";

//function will be assigned as initial last value of every watcher
function initWatchVal() {}

function Scope() {
  //$$ for private variables in angualar
  this.$$watchers = [];
  this.$$lastDirtyWatch = null; //for short-circuiting optimization
  this.$$asyncQueue = []; //for storing $evalAsync jobs that have been scheduled
  this.$$applyAsyncQueue = []; //for storing $applyAsync tasks that have been scheduled
  this.$$applyAsyncId = null; //for keeping track whether a setTimeout to drain queue has already been scheduled
  this.$$postDigestQueue = [];
  this.$$phase = null; //for scheduling $digest if one isn't already ongoing
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
  this.$beginPhase('$digest');

  //for flushing $applyAsync
  if(this.$$applyAsyncId){
    clearTimeout(this.$$applyAsyncId);
    this.$$flushApplyAsync();
  }

  do {
    //execution of deferred tasks
    while(this.$$asyncQueue.length){
      var asyncTask = this.$$asyncQueue.shift();
      asyncTask.scope.$eval(asyncTask.expression);
    }
    dirty = this.$$digestOnce();
    if ((dirty || this.$$asyncQueue.length) && !(ttl--)) {
      this.$clearPhase();
      throw "10 digest iterations reached";
    }
  } while (dirty || this.$$asyncQueue.length); 
  //with thid condition we guarantee that $evalAsync will be executed in this digest cycle
  //even if digest cycle is terminated due to absence of dirty watch
  this.$clearPhase(); // ending of digest phase

  while(this.$$postDigestQueue.length){
    this.$$postDigestQueue.shift()();
  }
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
    this.$beginPhase('$apply');
    return this.$eval(expr);
  }finally {
    this.$clearPhase(); // ending of apply phase
    this.$digest();
  }
};

//function which deffer expr execution but guarantee that it will be executed 
//before end of digest cycle
Scope.prototype.$evalAsync = function(expr){
  var self = this;
  //if there is not current phase of scope, and no async tasks have been scheduled yet
  //schedule the digest
  if(!self.$$phase && !self.$$asyncQueue.length){
    //digest will happen in near feature, regardless of when or where you invoke it
    //this way callers of $evalAsync can be ensured the function will return immediately
    setTimeout(function(){
      if(self.$$asyncQueue.length){
        self.$digest();
      }
    },0);
  }
  //we explicitly store current scope because of scope inheritance
  this.$$asyncQueue.push({scope: this, expression: expr});
};


Scope.prototype.$beginPhase = function(phase){
  if(this.$$phase){
    throw this.$$phase + ' already in progress.';
  }
  this.$$phase = phase;
};

Scope.prototype.$clearPhase = function(){
  this.$$phase = null;
};

//if we don't want to evaluate the given function immediately
//nor does it launch a digest immediately
//instead it schedules both of these things to happen after short period of time
//original motivation for handling http responses
Scope.prototype.$applyAsync = function(expr){
  var self = this;
  self.$$applyAsyncQueue.push(function(){
    self.$eval(expr);
  });
  if(self.$$applyAsyncId === null){
    self.$$applyAsyncId = setTimeout(function(){
      //we call $apply once outside the loop because we want to digest once
      self.$apply(_.bind(self.$$flushApplyAsync, self));
    }, 0);
  }
};

//this code is extracted from $applyAsync function
//so it can be reusable in $digest function
Scope.prototype.$$flushApplyAsync = function(){
  while(this.$$applyAsyncQueue.length){
    this.$$applyAsyncQueue.shift()();
  }
  this.$$applyAsyncId = null;
};


//function does not cause a digest to be scheduled
//execution is delayed until the digest happens for some other reason
Scope.prototype.$$postDigest = function(fn){
  this.$$postDigestQueue.push(fn);
};