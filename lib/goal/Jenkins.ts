/*
 * Copyright © 2019 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Deferred } from "@atomist/automation-client/lib/internal/util/Deferred";
import { sleep } from "@atomist/automation-client/lib/internal/util/poll";
import {
    DefaultGoalNameGenerator,
    ExecuteGoal,
    FulfillableGoalDetails,
    FulfillableGoalWithRegistrations,
    getGoalDefinitionFrom,
    Goal,
    GoalDefinition,
    GoalInvocation,
    ImplementationRegistration,
    IndependentOfEnvironment,
    ProgressTest,
    ReportProgress,
    SdmGoalEvent,
    SdmGoalState,
    serializeResult,
    testProgressReporter,
} from "@atomist/sdm";
import { postWebhook } from "@atomist/sdm-core";
import { codeLine } from "@atomist/slack-messages";
import * as _ from "lodash";

/**
 * Function to determine the name of the Jenkins job to start
 */
export type JenkinsJobName = (gi: GoalInvocation) => Promise<string>;

/**
 * Function to determine the parameters to be sent when starting the Jenkins job
 */
export type JenkinsJobParameters = (gi: GoalInvocation) => Promise<Record<string, string>>;

/**
 * Function to determine the definition of the Jenkins job to start
 */
export type JenkinsJobDefinition = (gi: GoalInvocation) => Promise<string>;

/**
 * Registration options for running a Jenkins job
 */
export interface JenkinsRegistration extends Partial<ImplementationRegistration> {

    /**
     * Optional name of the Jenkins job to start/manage
     *
     * If no name is provided or returned from JenkinsJobName, the name of
     * current repo is assumed to be the name of job to start.
     */
    job?: JenkinsJobName | string;

    /**
     * Optional flag to indicate whether or not the job should be started
     * by this goal after converging the definition
     *
     * If no explicit value is provided, this defaults to false; meaning
     * the job as indicated by job is started.
     */
    convergeOnly?: boolean;

    /** Optional parameters to be passed when starting the job */
    parameters?: JenkinsJobParameters | Record<string, string>;

    /** Optional job definition to use or create the job to start */
    definition?: JenkinsJobDefinition | string;

    /**
     * Optional configuration of the Jenkins server
     *
     * If not configuration is provided as part of the registration,
     * the SDM configuration will be checked at 'sdm.jenkins'.
     */
    server?: {
        url?: string;
        user?: string;
        password?: string;
    };
}

/**
 * Start a Jenkins job
 */
export function jenkins(goalDetails: string | FulfillableGoalDetails, registration: JenkinsRegistration = {}): Jenkins {
    const gd: FulfillableGoalDetails = {
        uniqueName: DefaultGoalNameGenerator.generateName("jenkins"),
    };
    if (typeof goalDetails === "string") {
        gd.displayName = `Jenkins ${codeLine(goalDetails)}`;
    } else {
        _.merge(gd, goalDetails);
        gd.displayName = `Jenkins ${codeLine(goalDetails.displayName)}`;
    }

    return new Jenkins(getGoalDefinitionFrom(gd, DefaultGoalNameGenerator.generateName("jenkins"), JenkinsDefinition)).with({
        name: DefaultGoalNameGenerator.generateName("jenkins"),
        ...registration,
    });
}

class Jenkins extends FulfillableGoalWithRegistrations<JenkinsRegistration> {

    constructor(private readonly goalDefinition: GoalDefinition,
                ...dependsOn: Goal[]) {
        super(goalDefinition, ...dependsOn);
    }

    public with(registration: JenkinsRegistration): this {
        this.addFulfillment({
            goalExecutor: executeJenkins(registration),
            progressReporter: JenkinsProgressReporter,
            ...registration as ImplementationRegistration,
        });
        return this;
    }
}

const JenkinsDefinition: GoalDefinition = {
    uniqueName: "jenkins",
    displayName: "jenkins",
    environment: IndependentOfEnvironment,
    retryFeasible: true,
};

export function executeJenkins(registration: JenkinsRegistration): ExecuteGoal {
    return async gi => {
        const { goalEvent, progressLog, context, configuration } = gi;

        const server = _.merge({}, registration.server, _.get(configuration, "sdm.jenkins"));

        if (!server.url) {
            throw new Error("Jenkins server configuration incomplete. Please configure your server url at 'sdm.jenkins.url'");
        }

        // Construct the jenkins url
        const url = new URL(server.url);
        url.username = server.user;
        url.password = server.password;

        // Get the jenkins api instance
        const js = require("jenkins")({ baseUrl: url.href, promisify: true, crumbIssuer: true });

        const jobName = await getJobName(registration, gi);
        const parameters = await getParameters(registration, gi);

        goalEvent.description = `Jenkins ${codeLine(jobName)}`;

        await createOrUpdateJob(jobName, registration, gi, js);

        if (registration.convergeOnly !== true) {

            progressLog.write("/--");
            progressLog.write("Starting Jenkins job '%s' with parameters '%j'", jobName, parameters || {});
            progressLog.write("\\--");

            const item = await triggerJob(jobName, parameters, js);

            if (!!item) {

                progressLog.write("/--");
                progressLog.write("Jenkins job '%s' started with build id '%s'", jobName, item.id || "<unkown>");
                progressLog.write("\\--");

                // Set build event to the backend
                await updateBuildStatus("started", goalEvent, item.url, item.id, context.workspaceId);

                // Set up log streaming
                const log = js.build.logStream(jobName, item.id);
                const deferred = new Deferred<void>();

                log.on("data", (text: string) => {
                    progressLog.write(text);
                });
                log.on("error", (err: any) => {
                    progressLog.write(serializeResult(err));
                });
                log.on("end", () => {
                    deferred.resolve();
                });

                // Now wait for the job to finish
                await deferred.promise;

                const result = await js.build.get(jobName, item.id);
                let status;
                let state;
                switch (result.result) {
                    case "SUCCESS":
                        status = "passed";
                        state = SdmGoalState.success;
                        break;
                    case "ABORTED":
                        status = "canceled";
                        state = SdmGoalState.stopped;
                        break;
                    case "FAILURE":
                        status = "failed";
                        state = SdmGoalState.failure;
                        break;
                }

                progressLog.write("/--");
                progressLog.write("Jenkins job '%s' completed with %s", jobName, state);
                progressLog.write("\\--");

                // Set build event to the backend
                await updateBuildStatus(status as any, goalEvent, item.url, item.id, context.workspaceId);

                return {
                    state,
                    description: `Jenkins ${codeLine(jobName)} ${status}`,
                    externalUrls: [
                        { label: "Log", url: result.url },
                    ],
                };
            }

            return {
                state: SdmGoalState.success,
                description: `Jenkins ${codeLine(jobName)} triggered`,
            };

        } else {
            progressLog.write("/--");
            progressLog.write("Not starting Jenkins job '%s'", jobName);
            progressLog.write("\\--");

            return {
                state: SdmGoalState.success,
                description: `Jenkins ${codeLine(jobName)} converged`,
            };
        }
    };
}

async function getJobName(registration: JenkinsRegistration, gi: GoalInvocation): Promise<string> {
    // Construct the name of the job to trigger
    let jobName: string;
    if (!!registration.job) {
        if (typeof registration.job === "string") {
            jobName = registration.job;
        } else {
            jobName = await registration.job(gi);
        }
    } else {
        jobName = gi.goalEvent.repo.name;
    }
    return jobName;
}

async function createOrUpdateJob(jobName: string,
                                 registration: JenkinsRegistration,
                                 gi: GoalInvocation,
                                 js: any): Promise<void> {
    const { progressLog } = gi;
    // Create or update the job if a definition is provided
    if (!!registration.definition) {
        let definition;
        if (typeof registration.definition === "string") {
            definition = registration.definition;
        } else {
            definition = await registration.definition(gi);
        }

        const exists = await js.job.exists(jobName);
        if (!!exists) {
            await js.job.config(jobName, definition);
        } else {
            await js.job.create(jobName, definition);
        }
        progressLog.write("/--");
        progressLog.write("Updating definition of Jenkins job '%s'", jobName);
        progressLog.write("\\--");
    } else {
        progressLog.write("/--");
        progressLog.write("Not updating definition of Jenkins job '%s' as no definition was provided.", jobName);
        progressLog.write("\\--");
    }
}

async function getParameters(registration: JenkinsRegistration,
                             gi: GoalInvocation): Promise<Record<string, string>> {
    let parameters;
    if (!!registration.parameters) {
        if (typeof registration.parameters === "function") {
            parameters = await registration.parameters(gi);
        } else {
            parameters = registration.parameters;
        }
    }
    return parameters;
}

async function triggerJob(jobName: string,
                          parameters: Record<string, string>,
                          js: any): Promise<undefined | { id: string, url: string }> {
    // Trigger the job to start
    const build = await js.job.build({ name: jobName, parameters });

    if (isNaN(build)) {
        return undefined;
    }

    // Wait for the job to be running
    let item;
    do {
        item = await js.queue.item(build);
        await sleep(500);
    } while (!item || !item.executable || !item.executable.number);
    return { id: item.executable.number, url: item.executable.url };
}

function updateBuildStatus(status: "started" | "failed" | "error" | "passed" | "canceled",
                           sdmGoal: SdmGoalEvent,
                           url: string,
                           buildNo: string,
                           team: string): Promise<any> {
    const data = {
        repository: {
            owner_name: sdmGoal.repo.owner,
            name: sdmGoal.repo.name,
        },
        name: `Build #${buildNo}`,
        number: +buildNo,
        type: "push",
        build_url: url,
        status,
        commit: sdmGoal.sha,
        branch: sdmGoal.branch,
        provider: "jenkins",
        started_at: status === "started" ? new Date().toISOString() : undefined,
        finished_at: status !== "started" ? new Date().toISOString() : undefined,
    };
    return postWebhook("build", data, team);
}

export const JenkinsProgressTests: ProgressTest[] = [{
    test: /Starting Jenkins job/i,
    phase: "queued",
}, {
    test: /Jenkins job '.*' started/i,
    phase: "started",
}, {
    test: /\[Pipeline\] { \((?:Declarative: )?(.*)\)/i,
    phase: "$1",
}, {
    test: /Jenkins job '%s' complated with/i,
    phase: "completed",
}];

export const JenkinsProgressReporter: ReportProgress = testProgressReporter(...JenkinsProgressTests);
