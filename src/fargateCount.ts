import AWS from 'aws-sdk';
import { runInThisContext } from 'vm';
import { PromiseResult } from 'aws-sdk/lib/request';
import { PerformanceObserver } from 'perf_hooks';
import { SSL_OP_SSLEAY_080_CLIENT_DH_BUG } from 'constants';
// import * as util from 'util';

AWS.config.update({region: 'us-east-1'});
var credentials = new AWS.SharedIniFileCredentials({profile: 'prod'});
AWS.config.credentials = credentials;

const ecs = new AWS.ECS();

export function fargateCount(): Promise<ServiceStatus> {
    const summary: Promise<ServiceStatus> = ecs.listClusters({}).promise()
        .then(clusterNameCallback)
        .then((s) => serviceNameCall(s)) //get ClusterAndServices[] promise
        .then((obj) => serviceDescribeCalls(obj)) //get ServiceStatus[] promise
        .then((obj) => addStats(obj)) //reduce all the stats into a single stat
        .catch( (err: AWS.AWSError) => {
            console.log(err);
            return EMPTY_SUMMARY;
        });
    return summary;
}
// list clusters in account
// AWS_PROFILE=prod aws ecs list-clusters
const clusterNameCallback = 
    function(data: AWS.ECS.Types.ListClustersResponse): Array<string> {
        var clusterNames: Array<string> = [];
        if(data && data.clusterArns) {
                data.clusterArns.forEach(s  => {
                const arr = s.split("/");
                const clusterName = arr[arr.length - 1];
                //console.log(clusterName);
                clusterNames.push(clusterName);
            });
        }
        return clusterNames;
    };

interface ClusterAndServices {
    cluster: string;
    services: string[];
}
//  list services in cluster
//  AWS_PROFILE=prod aws ecs list-services --cluster meetup-prod-web-cluster
const serviceNameCall = //returns [{clusterName,serviceNames}..]
    function(clusterNames:string[]): Promise<ClusterAndServices[]> {
        //var clusterAndServices: ClusterAndServices[] = []
        const proms: Promise<ClusterAndServices>[] = clusterNames.map( 
            (clusterName) => {
                return ecs
                    .listServices({cluster: clusterName})
                    .promise()
                    .then(serviceNameCallback)
                    .then((serviceNames) => new Promise<ClusterAndServices>((resolve) => {
                        //console.log(serviceNames);
                        resolve( {
                        cluster: clusterName,
                        services: serviceNames
                        }); 
                    }) );
            }
        );
        const flat = Promise.all(proms);
        return flat;
        // return clusterAndServices;
    };

const serviceNameCallback =
    function(data: AWS.ECS.Types.ListServicesResponse): string[] {
        var serviceNames: string[] = []
        if(data && data.serviceArns) {
            serviceNames = data.serviceArns.map( (arn) => {
                const arr = arn.split("/");
                const serviceName = arr[arr.length - 1];
                //console.log(serviceName);
                return serviceName;
            });
        }
    return serviceNames;
}
//      describe service
//          AWS_PROFILE=prod aws ecs describe-services --service classic-api-prod --cluster meetup-prod-web-cluster
export interface ServiceStatus {
    serviceName: string;
    desiredCount: number;
    runningCount: number;
    pendingCount: number;
    launchType: string;
}
const serviceDescribeCalls = function(clusterAndServices: ClusterAndServices[]): Promise<ServiceStatus[]> {
    //console.log(clusterAndServices);
    const servicePromises: Promise<PromiseResult<AWS.ECS.DescribeServicesResponse, AWS.AWSError>[]> 
    = Promise.all(clusterAndServices.flatMap( (cAss) => {
        const hasNoServices = (!cAss.services || cAss.services.length == 0);
        if(hasNoServices) {
            return [];
        }
        return multiServiceDescribeCall(cAss.cluster, cAss.services);
        //return cAss.services.map((service) => {return serviceDescribeCall(cAss.cluster, service);});
    }));
    //.service[0].desiredCount

    const statusPromises: Promise<ServiceStatus[]> = servicePromises
        .then( (awsResults) => {
            return awsResults
                .flatMap( (result, err) => {
                    if(!result || !result.services) {
                        return [];
                    }
                    return result.services
                        //.filter( (service) => { return service.launchType == "FARGATE"; })
                        .map( (service) => {
                            const status = {
                                serviceName: service.serviceName || "unknown",
                                desiredCount: service.desiredCount || 0,
                                runningCount: service.runningCount || 0,
                                pendingCount: service.pendingCount || 0,
                                launchType: service.launchType  || "unknown"
                            };
                            //console.log(`${JSON.stringify(status)}`);
                            return status;
                        });
                });
        });
    
    return statusPromises;
};

const multiServiceDescribeCall = function(clusterName: string, serviceNames: string[]):Promise<PromiseResult<AWS.ECS.DescribeServicesResponse, AWS.AWSError>> { 
    return ecs.describeServices({cluster: clusterName, services: serviceNames}).promise();
}

//adder

const addStats = function(serviceStatuses: ServiceStatus[]): ServiceStatus {
    return serviceStatuses.reduce( (prev, curr) => {
        if(curr.launchType && curr.launchType == 'FARGATE') {
            //console.log(curr); //this is nice to uncomment to see all the fargate services by name and running counts
            return {
                serviceName: prev.serviceName,
                desiredCount: prev.desiredCount + curr.desiredCount,
                runningCount: prev.runningCount + curr.runningCount,
                pendingCount: prev.pendingCount + curr.pendingCount,
                launchType: prev.launchType
            };
        } else {
            return prev;
        }
    }, EMPTY_SUMMARY);
};

const EMPTY_SUMMARY: ServiceStatus = {
    serviceName: "total",
    desiredCount: 0,
    runningCount: 0,
    pendingCount: 0,
    launchType: "FARGATE"
}