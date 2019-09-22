import AWS from 'aws-sdk';
import { runInThisContext } from 'vm';
import { PromiseResult } from 'aws-sdk/lib/request';
import { PerformanceObserver } from 'perf_hooks';
import { SSL_OP_SSLEAY_080_CLIENT_DH_BUG } from 'constants';

export interface ServiceStatus {
    serviceName: string;
    desiredCount: number;
    runningCount: number;
    pendingCount: number;
    launchType: string;
}

//intermediary representation of cluster & services collection for single cluster
interface ClusterAndServices {
    cluster: string;
    services: string[];
}

const EMPTY_SUMMARY: ServiceStatus = {
    serviceName: "total",
    desiredCount: 0,
    runningCount: 0,
    pendingCount: 0,
    launchType: "FARGATE"
}

export function fargateCount(): Promise<ServiceStatus> {
    const summary: Promise<ServiceStatus> = fetchClusters()
        .then(getClusterNames)
        .then((s) => getServiceNames(s)) //get ClusterAndServices[] promise
        .then((obj) => describeServices(obj)) //get ServiceStatus[] promise
        .then((obj) => addStats(obj)) //reduce all the stats into a single stat
        .catch( (err: AWS.AWSError) => { //still return an empty summary object when error happens. hm just error out might be better practice here.
            console.log(err);
            return EMPTY_SUMMARY;
        });
    return summary;
}
// list clusters in account
// AWS_PROFILE=prod aws ecs list-clusters
const getClusterNames = 
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

//  list services in cluster
//  AWS_PROFILE=prod aws ecs list-services --cluster meetup-prod-web-cluster
const getServiceNames = //returns [{clusterName,serviceNames}..]
    function(clusterNames:string[]): Promise<ClusterAndServices[]> {
        const proms: Promise<ClusterAndServices>[] = clusterNames.map( 
            (clusterName) => {
                return fetchServicesForCluster(clusterName)
                    .then(parseServiceNames)
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
    };
const parseServiceNames =
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
const describeServices = function(clusterAndServices: ClusterAndServices[]): Promise<ServiceStatus[]> {
    //console.log(clusterAndServices);
    const servicePromises: Promise<PromiseResult<AWS.ECS.DescribeServicesResponse, AWS.AWSError>[]> 
    = Promise.all(clusterAndServices.flatMap( (cAss) => {
        const hasNoServices = (!cAss.services || cAss.services.length == 0);
        if(hasNoServices) {
            return [];
        }
        return fetchMultiServiceDescribeCall(cAss.cluster, cAss.services);
    }));
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

//takes a set of stats and sums them up into a single ServiceStatus
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

//calls to AWS
AWS.config.update({region: 'us-east-1'});
var credentials = new AWS.SharedIniFileCredentials({profile: 'prod'});
AWS.config.credentials = credentials;
const ecs = new AWS.ECS();

const fetchServicesForCluster = function(clusterName: string) {
    return ecs
        .listServices({cluster: clusterName})
        .promise();
}

const fetchMultiServiceDescribeCall = function(clusterName: string, serviceNames: string[]):Promise<PromiseResult<AWS.ECS.DescribeServicesResponse, AWS.AWSError>> { 
    return ecs.describeServices({cluster: clusterName, services: serviceNames}).promise();
}

const fetchClusters = function(): Promise<PromiseResult<AWS.ECS.ListClustersRequest, AWS.AWSError>> {
    return ecs.listClusters({}).promise();
}