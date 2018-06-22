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
  this.$root = this; //specifies reference to root of scopes
  this.$$children = []; //for keeping child scopes
  this.$$listeners = {}; //for keeping listener function registered with $on function
  this.$$phase = null; //for scheduling $digest if one isn't already ongoing
}

Scope.prototype.$$areEqual = function(newValue, oldValue, valueEq) {
  if (valueEq) {
    return _.isEqual(newValue, oldValue);
  } else {
    return (
      newValue === oldValue ||
      (typeof newValue === "number" &&
        typeof oldValue === "number" &&
        isNaN(newValue) &&
        isNaN(oldValue))
    );
  }
};

//creates new watcher and push it in $$watchers array
Scope.prototype.$watch = function(watchFn, listenerFn, valueEq) {
  var self = this;
  var watcher = {
    watchFn: watchFn,
    listenerFn: listenerFn || function() {},
    valueEq: !!valueEq, //coercing variable to a real booolean by negating it twice
    last: initWatchVal
  };
  //we added new watch to begininig in case when we destroy watch doesn't effect
  //digest execution
  this.$$watchers.unshift(watcher);
  //disabling optimazition in case that listener of some watch add another watch
  this.$root.$$lastDirtyWatch = null;

  //retruning function witch removes added watch
  //in case we need to destroy watch before ending the scope
  return function() {
    var index = self.$$watchers.indexOf(watcher);
    if (index >= 0) {
      self.$$watchers.splice(index, 1);
      //we eliminate short-circuiting optimization on watch removal
      //to allow one watch to destroy another
      self.$root.$$lastDirtyWatch = null;
    }
  };
};

//digest trough watches once and return dirty if some watch return new value
Scope.prototype.$$digestOnce = function() {
  var dirty;
  //for tracking short-circuiting optimization
  var continueLoop = true;
  //self has this of scope
  var self = this;
  //for running through the whole hierarchy
  //and returning boolean indicating wheather any watch anywhere in the
  //hierarchy was dirty
  this.$$everyScope(function(scope) {
    var newValue, oldValue;
    //we iterate from end to begining in case we destroy watch
    //all watches we already passed through will be moved to left
    _.forEachRight(scope.$$watchers, function(watcher) {
      try {
        if (watcher) {
          newValue = watcher.watchFn(scope);
          //first time $digest is called oldValue will be undefined
          oldValue = watcher.last;
          if (!scope.$$areEqual(newValue, oldValue, watcher.valueEq)) {
            //we now know which is last dirty watcher
            scope.$root.$$lastDirtyWatch = watcher;
            //here we add last property to the watcher object and assign it new value
            watcher.last = watcher.valueEq ? _.cloneDeep(newValue) : newValue;
            watcher.listenerFn(
              newValue,
              oldValue === initWatchVal ? newValue : oldValue,
              scope
            );
            dirty = true;
          } else if (scope.$root.$$lastDirtyWatch === watcher) {
            continueLoop = false;
            return false;
          }
        }
      } catch (e) {
        console.log(e);
      }
    });
    return continueLoop;
  });
  return dirty;
};

//call $$digestOnce until dirty is true
Scope.prototype.$digest = function() {
  var ttl = 10; //time to live is 10 iteration
  var dirty;
  this.$root.$$lastDirtyWatch = null;
  this.$beginPhase("$digest");

  //for flushing $applyAsync
  if (this.$root.$$applyAsyncId) {
    clearTimeout(this.$root.$$applyAsyncId);
    this.$$flushApplyAsync();
  }

  do {
    //execution of deferred tasks
    while (this.$$asyncQueue.length) {
      try {
        var asyncTask = this.$$asyncQueue.shift();
        asyncTask.scope.$eval(asyncTask.expression);
      } catch (e) {
        console.error(e);
      }
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

  while (this.$$postDigestQueue.length) {
    try {
      this.$$postDigestQueue.shift()();
    } catch (e) {
      console.error(e);
    }
  }
};

//$eval function lets you execute some code in the context of a scope
//$eval represent building block for $apply
Scope.prototype.$eval = function(expr, locals) {
  return expr(this, locals);
};

//$apply is good way to integrate external libraries to Angular
//it executes function passed as argument with $eval and then run digest cycle
//integrating code to the "Angular lifecycle" using $apply
Scope.prototype.$apply = function(expr) {
  try {
    this.$beginPhase("$apply");
    return this.$eval(expr);
  } finally {
    this.$clearPhase(); // ending of apply phase
    //$root is added so digest cycle can start from top of hierarchy
    //and so include all parent scopes
    this.$root.$digest();
  }
};

//function which deffer expr execution but guarantee that it will be executed
//before end of digest cycle
Scope.prototype.$evalAsync = function(expr) {
  var self = this;
  //if there is not current phase of scope, and no async tasks have been scheduled yet
  //schedule the digest
  if (!self.$$phase && !self.$$asyncQueue.length) {
    //digest will happen in near feature, regardless of when or where you invoke it
    //this way callers of $evalAsync can be ensured the function will return immediately
    setTimeout(function() {
      if (self.$$asyncQueue.length) {
        //$root is added so digest cycle can start from top of hierarchy
        //and so include all parent scopes
        self.$root.$digest();
      }
    }, 0);
  }
  //we explicitly store current scope because of scope inheritance
  this.$$asyncQueue.push({ scope: this, expression: expr });
};

Scope.prototype.$beginPhase = function(phase) {
  if (this.$$phase) {
    throw this.$$phase + " already in progress.";
  }
  this.$$phase = phase;
};

Scope.prototype.$clearPhase = function() {
  this.$$phase = null;
};

//if we don't want to evaluate the given function immediately
//nor does it launch a digest immediately
//instead it schedules both of these things to happen after short period of time
//original motivation for handleing http responses
Scope.prototype.$applyAsync = function(expr) {
  var self = this;
  self.$$applyAsyncQueue.push(function() {
    self.$eval(expr);
  });
  if (self.$root.$$applyAsyncId === null) {
    self.$root.$$applyAsyncId = setTimeout(function() {
      //we call $apply once outside the loop because we want to digest once
      self.$apply(_.bind(self.$$flushApplyAsync, self));
    }, 0);
  }
};

//this code is extracted from $applyAsync function
//so it can be reusable in $digest function
Scope.prototype.$$flushApplyAsync = function() {
  while (this.$$applyAsyncQueue.length) {
    try {
      this.$$applyAsyncQueue.shift()();
    } catch (e) {
      console.error(e);
    }
  }
  this.$root.$$applyAsyncId = null;
};

//function does not cause a digest to be scheduled
//execution is delayed until the digest happens for some other reason
Scope.prototype.$$postDigest = function(fn) {
  this.$$postDigestQueue.push(fn);
};

//function watching more then one watchers and if anyone value is changed
//it calls listener function with array of values
Scope.prototype.$watchGroup = function(watchFns, listenerFn) {
  var self = this;
  var newValues = new Array(watchFns.length);
  var oldValues = new Array(watchFns.length);
  var changeReactionScheduled = false;
  var firstRun = true;

  //if we don't have watchers listener function is called with empty arrays
  //as arguments
  if (watchFns.length === 0) {
    var shouldCall = true;
    self.$evalAsync(function() {
      if (shouldCall) {
        listenerFn(newValues, newValues, self);
      }
    });
    return function() {
      shouldCall = false;
    };
  }
  //internal function witch is passed to $evalAsync
  //and it call listener with array of new and old values
  function watchGroupListener() {
    //first time copy newValues and oldValues as same reference
    if (firstRun) {
      firstRun = false;
      listenerFn(newValues, newValues, self);
    } else {
      listenerFn(newValues, oldValues, self);
    }
    changeReactionScheduled = false;
  }

  //getting array of destroyFunctions which will be passed in return function
  var destroyFunctions = _.map(watchFns, function(watchFn, i) {
    //create watch for each watcher
    return self.$watch(watchFn, function(newValue, oldValue) {
      newValues[i] = newValue;
      oldValues[i] = oldValue;
      if (!changeReactionScheduled) {
        changeReactionScheduled = true;
        //call sometime before digest is ended watchGroupListener function
        self.$evalAsync(watchGroupListener);
      }
    });
  });

  //return function calls destroyFunctions from array
  return function() {
    _.forEach(destroyFunctions, function(destroyFunction) {
      destroyFunction();
    });
  };
};

//creates child scope for current scope and returns it
//parameters: isoleted (optional) - isoleted scopes, parent (optional) - hierarhical parent
Scope.prototype.$new = function(isolated, parent) {
  var child;
  parent = parent || this;
  //creating isolated scope
  if (isolated) {
    child = new Scope();
    //assigning actual root of child in isolated case
    //otherwise it would be itself
    child.$root = parent.$root;
    //isolated scopes share the same copy of queues
    child.$$asyncQueue = parent.$$asyncQueue;
    child.$$postDigestQueue = parent.$$postDigestQueue;
    child.$$applyAsyncQueue = parent.$$applyAsyncQueue;
  } else {
    //constuctor function
    var ChildScope = function() {};
    //seting scope as prototype of ChildScope
    ChildScope.prototype = this;
    //creating new instance from constuctor function and return it
    child = new ChildScope();
  }
  //telling parent scope that child is being created
  parent.$$children.push(child);
  //shadowing parant $$watchers so when $digest function is called
  //only digest cycle on child is executed and not on whole scope
  //hierarchy
  child.$$watchers = [];
  //same as with $$watchers we shadowing $$listeners so every scope in hierarchy
  //have their on $$listeners object
  child.$$listeners  = {};
  //shadowing parent $$children so that proper scope has information
  //just for his own children
  child.$$children = [];
  //reference to parent scope
  child.$parent = parent;
  return child;
};

//executes an arbitrary function once for each scope in the hierarchy
//until function returns a falsy value
Scope.prototype.$$everyScope = function(fn) {
  if (fn(this)) {
    return this.$$children.every(function(child) {
      return child.$$everyScope(fn);
    });
  } else {
    return false;
  }
};

//function finds current scope from its parent's children array and remove it
//scope can not be root scope and must have a parent
//removes watchers of the scope
Scope.prototype.$destroy = function() {
  if (this.$parent) {
    var siblings = this.$parent.$$children;
    var indexOfThis = siblings.indexOf(this);
    if (indexOfThis >= 0) {
      siblings.splice(indexOfThis, 1);
    }
  }
  this.$$watchers = null;
};

//function wathces over some collection (array or object), and notified if
//collection is changed, or something within it is changed. Optimization of
//value wathces where is whatched only first level of collection (don't go deep
// into objects graph)
Scope.prototype.$watchCollection = function(watchFn, listenerFn) {
  var self = this;
  var newValue;
  var oldValue;
  var oldLength;
  // variable that will be passed to listener function with actual old value
  var veryOldValue;
  //variable for optimization purposes, length of Function contains number of 
  //declared arguments
  var trackVeryOldValue = (listenerFn.length > 1);
  var changeCount = 0;
  //if true we need to assign veryOldValue a value so it don't be undifined
  var firstRun = true;

  var internalWatchFn = function(scope) {
    var newLength;
    newValue = watchFn(scope);
    if (_.isObject(newValue)) {
      //in case collection is array or array like object
      var length = newValue.length;
      if (length === 0 || (_.isNumber(length) && length > 0 && (length - 1) in newValue) ) {
        if(!_.isArray(oldValue)){
          changeCount++;
          oldValue = [];
        }
        if(newValue.length !== oldValue.length){
          changeCount++;
          oldValue.length = newValue.length;
        }

        _.forEach(newValue, function(newItem, i){
          var bothNaN = _.isNaN(newItem) && _.isNaN(oldValue[i]);
          if(!bothNaN && newItem !== oldValue[i]){
            changeCount++;
            oldValue[i] = newItem;
          }
        });
        //in case collection is non array object
      } else {
        if(!_.isObject(oldValue) || _.isArray(oldValue)){
          changeCount++;
          oldValue = {};
          oldLength = 0;
        }
        newLength = 0;
        //iterates over an object's memebers, but only the ones
        //defined for the object itself.Members inherited through
        //the prototype chain are excluded
        _.forOwn(newValue, function(newVal,key){
          newLength++;
          if(oldValue.hasOwnProperty(key)){
            var bothNaN = _.isNaN(newVal) && _.isNaN(oldValue[key]); 
            if(!bothNaN && oldValue[key] !== newVal) {
              changeCount++;
              oldValue[key] = newVal;
            }
          } else {
            changeCount++;
            oldLength++;
            oldValue[key] = newVal;
          }
        });

        if(oldLength > newLength){
          changeCount++;
          _.forOwn(oldValue, function(oldVal, key){
            if(!newValue.hasOwnProperty(key)) {
              oldLength--;
              delete oldValue[key];
            }
          });
        }
      }
    }
    //in case if we are not watching collection
    else {
      if (!self.$$areEqual(newValue, oldValue, false)) {
        changeCount++;
      }
      oldValue = newValue;
    }
    return changeCount;
  };

  var internalListenerFn = function() {
    if(firstRun){
      listenerFn(newValue,newValue,self);
      firstRun = false;
    } else {
      listenerFn(newValue, veryOldValue, self);
    }
    if(trackVeryOldValue){
      veryOldValue = _.clone(newValue);
    }
  };

  return this.$watch(internalWatchFn, internalListenerFn);
};

//function which register listener for specific event
//if event doesn't exists in $$listeners object it add it
Scope.prototype.$on = function(eventName, listener) {
  var listeners = this.$$listeners[eventName];
  if(!listeners){
    //now listeners and $$listeners[eventName] have reference to same array
    this.$$listeners[eventName] = listeners = [];
  }
  listeners.push(listener);
};

//function pass through all listeners wich are registered with proper event
// and call them
Scope.prototype.$emit = function(eventName){
  //rest function returns all elements of collection except first one
  var additionalArguments = _.drop(arguments);
  this.$$fireEventOnScope(eventName,additionalArguments);
};

//function pass through all listeners wich are registered with proper event
// and call them
Scope.prototype.$broadcast = function(eventName) {
  var additionalArguments = _.drop(arguments);
  this.$$fireEventOnScope(eventName,additionalArguments);
};

//function which contains duplicate code from $emit and $broadcast
Scope.prototype.$$fireEventOnScope = function(eventName,additionalArgs){
  var event = {name: eventName};
  var listenerArgs = [event].concat(additionalArgs);
  var listeners = this.$$listeners[eventName] || [];
  _.forEach(listeners, function(listener){
    listener.apply(null, listenerArgs);
  });
};
