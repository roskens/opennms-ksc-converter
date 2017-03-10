/* 
 * Copyright (C) 2016 Ronald J. Roskens <ronald.roskens@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

var path = require('path'),
    util = require('util'),
    vm = require('vm'),
    fs = require('fs'),
    xml2js = require('xml2js'),
    request = require('request');

global._ = require('lodash');

var graphCache = {};

var includeInThisContext = function (path) {
    var code = fs.readFileSync(path);
    vm.runInThisContext(code, path);
}.bind(this);
includeInThisContext(path.join(__dirname, "backshift.js"));
includeInThisContext(path.join(__dirname, "Dashboard.js"));
includeInThisContext(path.join(__dirname, "Panel.js"));
includeInThisContext(path.join(__dirname, "Row.js"));

var nodeRE = new RegExp('^(node\\[\\d+\\])\\.(.*)$');
var fsRE = new RegExp('^node\\[(\\S+?)\\]\\.(.*)$');

function addPanelToDashboardRow(dashboard, graphs_per_line, graph, graphDef, pId) {
    console.log('==== addPanelToDashboardRow ====');
    var row = dashboard.lastRow();

    var rrdGraphConverter = new Backshift.Utilities.RrdGraphConverter({
        graphDef: graphDef,
        resourceId: graph['$']['resourceId']
    });
    var model = rrdGraphConverter.model;
    console.log('==== model ====');
    console.dir(model);
    panel = new Panel(graph['$']['title']);
    panel.setId(pId);

    // metrics & series arrays to look at.
    // 
    _.forEach(model.metrics, function (metric, key) {
        //console.log('==== metric ====')
        //console.dir(series)
        if ('attribute' in metric) {
            //console.log('metric.resourceId:' + metric.resourceId)
            var reMatch = nodeRE.exec(metric.resourceId);
            if (reMatch !== null) {
                console.log(reMatch);
                var nodeId = reMatch[1];
                var resourceId = reMatch[2];
            } else {
                var fsMatch = fsRE.exec(metric.resourceId);
                if (fsMatch !== null) {
                    console.log(fsMatch);
                    var nodeId = fsMatch[1];
                    var resourceId = fsMatch[2];
                }
            }

            panel.targets.push({
                "type": "attribute",
                "name": metric.name,
                "label": metric.label,
                "nodeId": nodeId,
                "resourceId": resourceId,
                "attribute": metric.attribute,
                "aggregation": metric.aggregation,
                "hide": metric.transient
            });
        }
        if ('expression' in metric) {
            panel.targets.push({
                "type": "expression",
                "label": metric.name,
                "expression": metric.expression,
                "hide": metric.transient
            });
        }
    });
    row.addPanel(panel);

    if (graphs_per_line === 0) {
        dashboard.rows.push(row);
        row = new Row("Row");
    }
}

function getGraphDefinition(name) {
    return new Promise(function (resolve, reject) {
        if (name in graphCache) {
            resolve(graphCache[name]);
        }

        //console.log('url: ' + 'http://localhost:8980/opennms/rest/graphs/' + encodeURIComponent(name))
        request.get({url: 'http://localhost:8980/opennms/rest/graphs/' + encodeURIComponent(name),
            auth: {'username': 'admin', 'password': 'admin'},
            json: true}, function (err, res, graphDef) {
            if (res.statusCode === 200 && typeof (graphDef) !== 'undefined') {
                graphCache[name] = graphDef;
                resolve(graphDef);
            } else {
                reject(Error("request failed: code:" + res.statusCode));
            }
        });
    }).then(function (value) {
        console.log('graphCache[' + name + '] = ' + value);
        return value;
    }, function (error) {
        console.error(error);
    });
}

function buildDashboard(report, graphs, graphDefs) {
    console.log(">>>> buildDashboard");
    console.log("report: ", report);
    var dashboard = new Dashboard( report['title'] );
    dashboard.addTag("ksc-performance-report");
    var graphs_per_line = report['graphs_per_line'] === 'undefined' ? 1 : report['graphs_per_line'] ;

    var panelId = 1;
    _.forEach(graphs, function (graph, key) {
        if(report['graphs_per_line'])
        addPanelToDashboardRow(dashboard, report['graphs_per_line'], graph, graphDefs[graph['$']['graphtype']], panelId++);
    });
    console.log('writing out file:' + report['title'] + '.json');
    fs.writeFileSync(report['title'] + '.json', dashboard.toJson());

    console.log('<<<< buildDashboard <' + report['title'] + '> --');
    return;
}

function collectGraphTypes(reportDefinition) {
    var allGraphTypes = [];
    _.each(reportDefinition.ReportsList.Report, function (report) {
        _.each(report.Graph, function (graph) {
            allGraphTypes.push(graph['$'].graphtype);
        });
    });

    allGraphTypes = _.uniq(allGraphTypes);
    return allGraphTypes;
}

function getGraphTypeDefinitions(graphTypeList) {
    return new Promise(function (resolve, reject) {
        var promises = [];
        _.each(graphTypeList, function (graphType) {

            promises.push(fetchGraphType(graphType));
        });
        Promise.all(promises).then(
                function (value) {
                    resolve(value);
                },
                function (error) {
                    console.error(error);
                }
        );
    });
}

function fetchGraphType(graphType) {
    return new Promise(function (resolve, reject) {
        request.get({url: 'http://localhost:8980/opennms/rest/graphs/' + encodeURIComponent(graphType),
            auth: {'username': 'admin', 'password': 'admin'},
            json: true}, function (err, res, graphDef) {
            if (res.statusCode === 200) {
                //console.log('typeof(graphDef):' + typeof(graphDef))
                //console.dir(dashboard)
                //console.dir(graph)
                //console.dir(row);

                if (typeof (graphDef) !== 'undefined') {
                    resolve(graphDef);
                }
            } else {
                reject(Error("request failed: " + res.statusCode));
            }
        });
    });
}

var kscPath = 'ksc.xml';
console.log('Reading ' + kscPath);

var reportsList = [];

var parser = new xml2js.Parser({trim: true});
fs.readFile(kscPath, function (err, data) {
    parser.parseString(data, function (err, result) {
        var graphTypes = collectGraphTypes(result);
        getGraphTypeDefinitions(graphTypes).then(
                function (allDefs) {
                    //console.log('done!', allDefs);
                    //console.dir(result.ReportsList.Report)
                    var gdefs = {};
                    _.forEach(allDefs, function (g, k) {
                        console.log('g.name:' + g.name);
                        gdefs[g.name] = g;
                    });
                    _.forEach(result.ReportsList.Report, function (report, key) {
                        console.log('calling buildDashboard');
                        buildDashboard(report['$'], report['Graph'], gdefs);
                    });
                },
                function (error) {
                    console.error(error);
                }
        );
    });
});
