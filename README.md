# json5-parser
Scanner and parser for [JSON5](https://json5.org/) based on Microsoft's [node-jsonc-parser](https://github.com/microsoft/node-jsonc-parser).

Why?
----
This node module provides a scanner and fault tolerant parser that can process JSON5.
 - the *scanner* tokenizes the input string into tokens and token offsets
 - the *visit* function implements a 'SAX' style parser with callbacks for the encountered properties and values.
 - the *parseTree* function computes a hierarchical DOM with offsets representing the encountered properties and values.
 - the *parse* function evaluates the JavaScript object represented by JSON string in a fault tolerant fashion. 
 - the *getLocation* API returns a location object that describes the property or value located at a given offset in a JSON document.
 - the *findNodeAtLocation* API finds the node at a given location path in a JSON DOM.
