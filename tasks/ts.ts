/// <reference path="../defs/node/node.d.ts"/>
/// <reference path="../defs/grunt/grunt.d.ts"/>
/// <reference path="../defs/underscore/underscore.d.ts"/>
/// <reference path="../defs/underscore.string/underscore.string.d.ts"/>

/*
 * grunt-ts
 * Licensed under the MIT license.
 */


declare var require;
declare var __dirname;
declare var mapObj;
declare var key;

interface ICompileResult {
    code: number;
    output: string;
}

interface ITargetOptions {
    src: string[]; // input files  // Note : this is a getter and returns a new "live globbed" array 
    reference: string; // path to a reference.ts e.g. './approot/'
    out: string; // if sepecified e.g. 'single.js' all output js files are merged into single.js using tsc --out command 
    watch: string; // if specified e.g. './appdir/' will watch the directory for changes. Note that specifing this makes the grunt task async (i.e. it keep running)
}

interface ITaskOptions {
    target: string; // es3 , es5 
    module: string; // amd, commonjs 
    sourcemap: boolean;
    declaration: boolean;    
    comments: boolean;
}

// General util functions 
function insertArrayAt(array:string[], index:number, arrayToInsert:string[]) {
    Array.prototype.splice.apply(array, [index, 0].concat(arrayToInsert));
    return array;
}
// Useful string functions 
// used to make sure string ends with a slash 
function endsWith(str: string, suffix: string) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
};
function endWithSlash(path: string): string {
    if (!endsWith(path, '/') && !endsWith(path, '\\')) {
        return path + '/';
    }
    return path;
}


// Typescript imports 
import _ = require('underscore');
import _str = require('underscore.string');
import path = require('path');
import fs = require('fs');
import os = require('os');
// plain vanilla imports
var shell = require('shelljs');
var eol = os.EOL;

function pluginFn(grunt: IGrunt) {

    function resolveTypeScriptBinPath(currentPath, depth): string {
        var targetPath = path.resolve(__dirname,
            (new Array(depth + 1)).join("../../"),
            "../node_modules/typescript/bin");
        if (path.resolve(currentPath, "node_modules/typescript/bin").length > targetPath.length) {
            return;
        }
        if (fs.existsSync(path.resolve(targetPath, "typescript.js"))) {
            return targetPath;
        }

        return resolveTypeScriptBinPath(currentPath, ++depth);
    }

    function getTsc(binPath: string): string {
        return '"' + binPath + '/' + 'tsc" ';
    }

    var exec = shell.exec;
    var cwd = path.resolve(".");
    var tsc = getTsc(resolveTypeScriptBinPath(cwd, 0));

    // Blindly runs the tsc task using provided options 
    function compileAllFiles(files: string[], target: ITargetOptions, task: ITaskOptions): ICompileResult {

        var filepath: string = files.join(' ');
        var cmd = 'node ' + tsc + ' ' + filepath;

        // boolean options 
        if (task.sourcemap)
            cmd = cmd + ' --sourcemap';
        if (task.declaration)
            cmd = cmd + ' --declaration';        
        if (!task.comments)
            cmd = cmd + ' --removeComments';

        // string options
        cmd = cmd + ' --target ' + task.target.toUpperCase();
        cmd = cmd + ' --module ' + task.module.toLowerCase();

        // Target options: 
        if (target.out) {
            cmd = cmd + ' --out ' + target.out;
        }

        // To debug the tsc command
        //console.log(cmd);

        var result = exec(cmd);
        return result;
    }

    // Updates the reference file 
    function updateReferenceFile(files: string[], referenceFile: string, referencePath: string) {        
        var referenceIntro = '/// <reference path="';
        var referenceEnd = '" />';
        var referenceMatch = /\/\/\/ <reference path=\"(.*?)\"/;
        var ourSignatureStart = '//grunt-start';
        var ourSignatureEnd = '//grunt-end';

        var origFileLines = []; // The lines we do not modify and send out as is. Lines will we reach grunt-ts generated
        var origFileReferences = []; // The list of files already there that we do not need to manage 

        // Location of our generated references
        // By default at start of file
        var signatureSectionPosition = 0; 

        // Read the original file if it exists 
        if (fs.existsSync(referenceFile)) {
            var lines = fs.readFileSync(referenceFile).toString().split('\n');            

            var inSignatureSection = false;           
            // By default at end of file
            signatureSectionPosition = lines.length; 
            for (var i = 0; i < lines.length; i++) {

                var line = _str.trim(lines[i]);

                // Skip logic for our generated section 
                if (_str.include(line, ourSignatureStart)) {
                    //Wait for the end signature: 
                    signatureSectionPosition = i;
                    inSignatureSection = true;
                    continue;
                }
                if (_str.include(line, ourSignatureEnd)) {
                    inSignatureSection = false;                    
                    continue;
                }
                if (inSignatureSection) continue;
                
                // store the line     
                origFileLines.push(line);

                // Fetch the existing reference's filename if any: 
                if (_str.include(line, referenceIntro)) {
                    var match = line.match(referenceMatch);                    
                    var filename = match[1];
                    origFileReferences.push(filename);
                }
            }
        }

        var contents = [ourSignatureStart];
        files.forEach((filename: string) => {
            // The file we are about to add 
            var filepath = path.relative(referencePath, filename).split('\\').join('/');

            // If there are orig references 
            if (origFileReferences.length) {                
                if (_.contains(origFileReferences, filepath)) {                    
                    return;
                }
            }

            // Finally add the filepath 
            contents.push(referenceIntro + filepath + referenceEnd);
        });
        contents.push(ourSignatureEnd);
        
        // Modify the orig contents to put in our contents 
        origFileLines = insertArrayAt(origFileLines, signatureSectionPosition, contents);
        fs.writeFileSync(referenceFile, origFileLines.join(eol));
    }    

    // Note: this funciton is called once for each target 
    // so task + target options are a bit blurred inside this function 
    grunt.registerMultiTask('ts', 'Compile TypeScript files', function () {

        var currenttask: ITask = this;

        // setup default options 
        var options = currenttask.options<ITaskOptions>({
            module: 'amd',
            target: 'es3',
            declaration: false,
            sourcemap: true,            
            comments: false
        });

        // Was the whole process successful
        var success = true;
        var watch;

        // Some interesting logs: 
        //http://gruntjs.com/api/inside-tasks#inside-multi-tasks
        //console.log(this)
        //console.log(this.files[0]); // An array of target files ( only one in our case )
        //console.log(this.files[0].src); // a getter for a resolved list of files 
        //console.log(this.files[0].orig.src); // The original glob / array / !array / <% array %> for files. Can be very fancy :) 

        // this.files[0] is actually a single in our case as we gave examples of  one source / out per target
        this.files.forEach(function (target: ITargetOptions) {


            // Create a reference file? 
            var reference = target.reference;
            var referenceFile;
            var referencePath;
            if (!!reference) {
                referenceFile = path.resolve(reference);
                referencePath = path.dirname(referenceFile)
            }
            function isReferenceFile(filename: string) {
                return path.resolve(filename) == referenceFile;
            }

            // Create an output file? 
            var out = target.out;
            var outFile;
            var outFile_d_ts;
            if (!!out) {
                outFile = path.resolve(out);
                outFile_d_ts = outFile.replace('.js', '.d.ts');
            }
            function isOutFile(filename: string): boolean {
                return path.resolve(filename) == outFile_d_ts;
            }

            // Compiles all the files 
            // Uses the blind tsc compile task
            // Creates custom files
            // logs errors
            // Time the whole process
            function runCompilation(files) {
                grunt.log.writeln('Compiling.'.yellow);

                // Time the task and go 
                var starttime = new Date().getTime();

                // Create a reference file if specified
                if (!!referencePath) {
                    updateReferenceFile(files, referenceFile, referencePath);
                }

                // The files to compile 
                var filesToCompile = files;      

                // If reference and out are both specified.
                // Then only compile the udpated reference file as that contains the correct order                           
                if (!!referencePath && target.out) { filesToCompile = [referenceFile] };
                
                // Quote the files to compile 
                filesToCompile = _.map(filesToCompile, (item) => {return '"' + item + '"' });

                // Compile the files 
                var result = compileAllFiles(filesToCompile, target, options);
                if (result.code != 0) {
                    var msg = "Compilation failed"/*+result.output*/;
                    grunt.log.error(msg.red);
                    success = false;
                }
                else {
                    var endtime = new Date().getTime();
                    var time = (endtime - starttime) / 1000;
                    grunt.log.writeln(('Success: ' + time.toFixed(2) + 's for ' + files.length + ' typescript files').green);
                }
            }

            // Find out which files to compile
            // Then calls the compile function on those files 
            // Also this funciton is debounced
            function filterFilesAndCompile() {
                // Reexpand the original file glob: 
                var files = grunt.file.expand(currenttask.data.src);

                // Clear the files of output.d.ts and reference.ts 
                files = _.filter(files, (filename) => {
                    return (!isReferenceFile(filename) && !isOutFile(filename));
                });

                // compile 
                runCompilation(files);
            }
            var debouncedCompile = _.debounce(filterFilesAndCompile, 150); // randomly chosen 150. Choice was made because chokidar looks at file system every 100ms 

            // Initial compilation: 
            filterFilesAndCompile();

            // Watches all the files 
            watch = target.watch;
            if (!!watch) {
                // get path                
                watch = path.resolve(watch);

                // make async 
                var done = currenttask.async();

                var watchpath = watch;
                grunt.log.writeln(('Watching all Typescript files under : ' + watchpath).cyan);

                // create a gaze instance for path 
                var chokidar = require('chokidar');
                var watcher = chokidar.watch(watchpath, { ignoreInitial: true, persistent: true });

                // local event to handle file event 
                function handleFileEvent(filepath: string, displaystr: string) {
                    // Ignore the special cases for files we generate
                    if (isOutFile(filepath) || isReferenceFile(filepath)) {
                        return;
                    }
                    if (!endsWith(filepath, '.ts')) { // should not happen
                        return;
                    }

                    grunt.log.writeln((displaystr + ' >>' + filepath).yellow);
                    debouncedCompile();
                }

                // A file has been added/changed/deleted has occurred
                watcher.on('add', function (path) { handleFileEvent(path, '+++ added  '); })
                    .on('change', function (path) { handleFileEvent(path, '### changed'); })
                    .on('unlink', function (path) { handleFileEvent(path, '--- removed'); })
                    .on('error', function (error) { console.error('Error happened', error); });
            }
        });

        if (!watch)
            return success;
    });
};
export = pluginFn;