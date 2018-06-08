/*jshint globalstrict: true */
'use strict';
//mixin function extend Lo-Dash library with object containing our own function
_.mixin({
    isArraylike: function(obj){
        if(_.isNull(obj) || _.isUndefined(obj)){
            return false;
        }

        var length = obj.length;
        return _.isNumber(length);
    }
});