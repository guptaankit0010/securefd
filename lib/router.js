'use strict';
const { centralErrorHandler } = require('../middleware/errorHandler');

function Router() {
    this._routes = [];
}

Router.prototype.addRoute = function (route) {
    this._routes.push(route);
};

Router.prototype.handle = async function (req, res) {
    const route = this.getRoute(req);
    if (!route) {
        res.statusCode = 404;
        res.end("Route not found");
        return;
    }

    let handlerIndex = 0;

    const next = async () => {
        if (handlerIndex >= route.handlers.length) return;

        const currentHandler = route.handlers[handlerIndex++];
        try {
            await currentHandler(req, res, next);
        } catch (err) {
            centralErrorHandler(err, req, res);
        }
    };

    next();
};


Router.prototype.getRoute = function (req) {
    const method = req.method;
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = parsedUrl.pathname;

    for (let i = 0; i < this._routes.length; i++) {
        const route = this._routes[i];
        if (route.method === method && route.regex.test(pathname)) {
            const params = this.getParams(route, pathname);
            req.params = params;
            req.query = Object.fromEntries([...parsedUrl.searchParams.entries()].map(([k, v]) => [k.trim(), v]));
            return route;
        }
    }
}

Router.prototype.getParams = function (route, url) {
    const params = {};
    const keys = [];
    route.path.trim().replace(/:(\w+)/g, (_, key) => keys.push(key));
    const match = route.regex.exec(url);
    if (match) keys.forEach((key, i) => { params[key] = match[i + 1]; });
    return params;
}

Router.prototype.init = function () {
    // Loop over this._routes and add regex for each route path
    // this regex will be used to match the incoming request path with the route path
    // and extract the params from the request path and add them to the req.params object

    this._routes.forEach(route => {
        const path = route.path.trim();
        const regex = new RegExp(`^${path.replace(/:\w+/g, '([^/]+)')}$`);
        route.regex = regex;
    })
}

module.exports = { Router };