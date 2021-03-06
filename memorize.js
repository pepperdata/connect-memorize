'use strict';

var fs = require('fs'),
    mkdirp = require('mkdirp'),
    path = require('path'),
    extend = require('extend');

module.exports = function(options) {

    options = extend({
        /* Function(req) or regular expression to match the url */
        match: false,
        memorize: true,
        /* Function(url, req) or boolean */
        recall: false,
        storageDir: 'offline',
        /* Function(url, req) or regular expression to normalize the url. 
        If regular expression is used, the first subpattern will be used as a new url */
        normalize: /^.*?\/\/.+?(\/.*$)/, // remove host
        verbose: false
    }, options);

    if (!options.storageDir) throw 'options.storageDir is not defined!';

    return function(req, res, next) {
        if ('GET' !== req.method/* && 'HEAD' != req.method*/) return next();

        if (typeof options.match === 'function') {
            if (!options.match(req)) {
                next();
                return;
            }
        } else if (options.match) {
            if (!req.url.match(options.match)) {
                next();
                return;
            }
        }

        var urlPath = req.url;
        if (typeof options.normalize === 'function') {
            urlPath = options.normalize(urlPath, req);
        } else if (options.normalize) {
            urlPath = urlPath.match(options.normalize);
            urlPath = urlPath && urlPath[1] ? urlPath[1] : req.url;
        }

        urlPath = escape(urlPath);
        if (urlPath[0] === '/') urlPath = urlPath.substr(1);
        if (urlPath === '') urlPath = 'index';

        var storageFile = options.storageDir + '/' + urlPath;

        if ((typeof options.recall === 'function' && options.recall(urlPath, req))
            || options.recall === true) {
          // try to serve offline file
          if (fs.existsSync(storageFile) && fs.statSync(storageFile).isFile()) {
            fs.createReadStream(storageFile).pipe(res);
            if (options.verbose) console.log('served from local file: ', storageFile);
            return;
          }
        }

        if (options.memorize) {
            // memorize the response
            var _write = res.write,
                _end = res.end,
                _writeHead = res.writeHead,
                file,
                // get a unique filename so 2 requests don't try to overwrite each other
                partFile = storageFile + '.part' + Math.round(Math.random() * 10000000 + 10000000);

            var memorize = function(data, enc) {
                if (file === false || !data) return; // storing disabled, or no data
                if (res.statusCode !== 200) {
                    if (file === undefined) {
                        if (options.verbose) console.log('Can\'t memorize ', req.url, ', response code:', res.statusCode);
                        file = false;
                    }
                    return;
                }
                if (!file) {
                    // lazy initialize file on first write
                    mkdirp.sync(path.dirname(partFile));
                    file = fs.openSync(partFile, 'w');
                }
                if (typeof data === 'string') data = new Buffer(data, enc);
                fs.writeSync(file, data, 0, data.length);
            }  

            res.write = function(data, enc) {
                memorize(data, enc);
                return _write.call(this, data, enc);
            }
            res.end = function(data, enc) {
                memorize(data, enc);
                if (file) {
                    fs.closeSync(file);
                    try {
                        fs.renameSync(partFile, storageFile);
                      if (options.verbose) console.log('Stored response in', storageFile);
                    } catch (e) {
                        console.log('Can\'t rename ', partFile, ' to ', storageFile);
                    }
                }
                return _end.call(this, data, enc);
            }

            res.on('error', function (err) {
                if (options.verbose) console.log('Can\'t memorize ', req.url, ', response error:', err);
                if (!file) file = false;
            });
        }

        next();
    };
}
