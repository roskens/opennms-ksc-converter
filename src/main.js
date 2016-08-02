/* 
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */

var path = require('path'),
    util = require('util'),
    vm = require('vm'),
    fs = require('fs'),
    xml2js = require('xml2js'),
    request = require('request'),
    _ = require('lodash');

var graphCache = {};

var includeInThisContext = function (path) {
    var code = fs.readFileSync(path);
    vm.runInThisContext(code, path);
}.bind(this);
includeInThisContext(path.join(__dirname, "backshift.js"));

function createPanel(title, pId) {
    //console.log('======== panel: ' + title + ' ========')
    return {
        "aliasColors": {},
        "bars": false,
        "datasource": "${DS_OPENNMS}",
        "editable": false,
        "error": false,
        "fill": 0,
        "grid": {
            "threshold1": null,
            "threshold1Color": "rgba(216, 200, 27, 0.27)",
            "threshold2": null,
            "threshold2Color": "rgba(234, 112, 112, 0.22)"
        },
        "id": pId,
        "isNew": true,
        "legend": {
            "avg": false,
            "current": false,
            "max": false,
            "min": false,
            "show": true,
            "total": false,
            "values": false
        },
        "lines": true,
        "linewidth": 2,
        "links": [],
        "nullPointMode": "connected",
        "percentage": false,
        "pointradius": 5,
        "points": false,
        "renderer": "flot",
        "seriesOverrides": [],
        "span": 6,
        "stack": false,
        "steppedLine": false,
        "targets": [
        ],
        "timeFrom": null,
        "timeShift": null,
        "title": title,
        "tooltip": {
            "msResolution": true,
            "shared": true,
            "sort": 0,
            "value_type": "cumulative"
        },
        "type": "graph",
        "xaxis": {
            "show": true
        },
        "yaxes": [
            {
                "format": "short",
                "label": null,
                "logBase": 1,
                "max": null,
                "min": null,
                "show": true
            },
            {
                "format": "short",
                "label": null,
                "logBase": 1,
                "max": null,
                "min": null,
                "show": true
            }
        ]
    };
}

function createRow() {
    //console.log('======== row ========')
    return {
        "collapse": false,
        "editable": true,
        // "height": 493,
        "panels": [],
        "title": "Row"
    };
}

var nodeRE = new RegExp('^(node\\[\\d+\\])\\.(.*)$');
var fsRE = new RegExp('^node\\[(\\S+?)\\]\\.(.*)$');

function addPanelToDashboardRow(dashboard, graphs_per_line, graph, graphDef, pId) {
    console.log('==== addPanelToDashboardRow ====');
    //console.dir(graphDef);
    //console.dir(dashboard.dashboard);
    var row = _.last(dashboard.rows);
    if (typeof row === 'undefined') {
        row = createRow();
        dashboard.rows.push(row);
    }

    var rrdGraphConverter = new Backshift.Utilities.RrdGraphConverter({
        graphDef: graphDef,
        resourceId: graph['$']['resourceId']
    });
    var model = rrdGraphConverter.model;
    console.log('==== model ====');
    console.dir(model);
    panel = createPanel(graph['$']['title'], pId);

    // metrics & series arrays to look at.
    // 
    _.forEach(model.metrics, function (metric, key) {
        //console.log('==== metric ====')
        //console.dir(metric)
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
    row.panels.push(panel);
    //console.log('== panel ==')
    //console.dir(panel);
    //console.log('== row ==')
    //console.dir(row);

    if (graphs_per_line === 0) {
        dashboard.rows.push(row);
        row = createRow();
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
    var dashboard = {
        "id": null,
        "title": report['title'],
        "tags": ["ksc-performance-report"],
        "timezone": "browser",
        "rows": [],
        "templating": {"list": []},
        "annotations": {"list": []},
        "schemaVersion": 12,
        "version": 0,
        "__inputs": [
            {
                "name": "DS_OPENNMS",
                "label": "OpenNMS",
                "description": "",
                "type": "datasource",
                "pluginId": "opennms-datasource",
                "pluginName": "OpenNMS"
            }
        ],
        "__requires": [
            {
                "type": "panel",
                "id": "graph",
                "name": "Graph",
                "version": ""
            },
            {
                "type": "grafana",
                "id": "grafana",
                "name": "Grafana",
                "version": "3.1.0"
            },
            {
                "type": "datasource",
                "id": "opennms",
                "name": "OpenNMS",
                "version": "2.0.1"
            }
        ]
    };

    var pId = 1;
    _.forEach(graphs, function (graph, key) {
        addPanelToDashboardRow(dashboard, report['graphs_per_line'], graph, graphDefs[graph['$']['graphtype']], pId++);
    });
    console.log('writing out file:' + report['title'] + '.json');
    fs.writeFile(report['title'] + '.json', JSON.stringify(dashboard, null, 2));

    // console.log('-- end buildDashboard <' + report['title'] + '> --');
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

var kscPath = path.join(__dirname, 'ksc.xml');
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
