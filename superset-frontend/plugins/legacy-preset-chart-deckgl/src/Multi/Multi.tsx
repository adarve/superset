/* eslint-disable react/jsx-handler-names */
/* eslint-disable react/no-access-state-in-setstate */
/* eslint-disable camelcase */
/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { isEqual } from 'lodash';
import {
  Datasource,
  HandlerFunction,
  JsonObject,
  JsonValue,
  QueryFormData,
  SupersetClient,
  usePrevious,
} from '@superset-ui/core';
import { Layer } from '@deck.gl/core';

import {
  DeckGLContainerHandle,
  DeckGLContainerStyledWrapper,
} from '../DeckGLContainer';
import { getExploreLongUrl } from '../utils/explore';
import layerGenerators from '../layers';
import { Viewport } from '../utils/fitViewport';
import { TooltipProps } from '../components/Tooltip';

export type DeckMultiProps = {
  formData: QueryFormData;
  payload: JsonObject;
  setControlValue: (control: string, value: JsonValue) => void;
  viewport: Viewport;
  onAddFilter: HandlerFunction;
  height: number;
  width: number;
  datasource: Datasource;
  onSelect: () => void;
};

const DeckMulti = (props: DeckMultiProps) => {
  const containerRef = useRef<DeckGLContainerHandle>();

  const [viewport, setViewport] = useState<Viewport>();
  const [subSlicesLayers, setSubSlicesLayers] = useState<Record<number, Layer>>(
    {},
  );

  const setTooltip = useCallback((tooltip: TooltipProps['tooltip']) => {
    const { current } = containerRef;
    if (current) {
      current.setTooltip(tooltip);
    }
  }, []);

  const loadLayers = useCallback(
    (formData: QueryFormData, payload: JsonObject, viewport?: Viewport) => {
      setViewport(viewport);
      setSubSlicesLayers({});
      payload.data.slices.forEach(
        (subslice: { slice_id: number } & JsonObject) => {
          // Filters applied to multi_deck are passed down to underlying charts
          // note that dashboard contextual information (filter_immune_slices and such) aren't
          // taken into consideration here
          // Debug filter info (will appear in browser console)
          console.group(`Filters for sublayer ${subslice.slice_id}`);
          console.log('Parent formData filters:', formData.filters);
          console.log('Parent formData extra_filters:', formData.extra_filters);
          console.log('Payload:', payload);
          console.log('Subslice original filters:', subslice.form_data.filters);
          
          // Extract all possible filter sources
          const appliedFilters = payload.applied_filters || 
                              (payload.data && payload.data.applied_filters) || [];
                              
          const dashboardFilters = formData.dashboardFilters || 
                                (payload.dashboard_filters) || 
                                (payload.data && payload.data.dashboard_filters) || {};
                                
          const extraFilters = formData.extra_filters || [];
          const crossFilters = payload.cross_filters || 
                            (payload.data && payload.data.cross_filters) || [];
          
          // Collect all filters
          const filters = [
            ...(subslice.form_data.filters || []),
            ...(formData.filters || []),
            ...extraFilters,
          ];
          
          // Add applied filters if available
          if (Array.isArray(appliedFilters) && appliedFilters.length > 0) {
            console.log('Adding applied_filters:', appliedFilters);
            filters.push(...appliedFilters);
          }
          
          // Add any cross filters if available
          if (Array.isArray(crossFilters) && crossFilters.length > 0) {
            console.log('Adding cross_filters:', crossFilters);
            filters.push(...crossFilters);
          }
          
          // Convert dashboard filters to the format expected by the API
          // Dashboard filters may be in a different format than other filters
          if (Object.keys(dashboardFilters).length > 0) {
            console.log('Adding dashboard_filters:', dashboardFilters);
            Object.entries(dashboardFilters).forEach(([key, value]) => {
              if (Array.isArray(value) && value.length > 0) {
                filters.push({
                  col: key,
                  op: 'IN',
                  val: value,
                });
              }
            });
          }
          
          console.log('Combined filters to be used:', filters);
          console.groupEnd();

          // Look for dashboard_data which contains actual filtered data
          const hasDashboardData = payload.dashboard_data || (payload.data && payload.data.dashboard_data);
          console.log('Dashboard data available:', !!hasDashboardData);
          
          // Create copy of the subslice with combined filters
          const subsliceCopy = {
            ...subslice,
            form_data: {
              ...subslice.form_data,
              filters,
              // Add extra_filters to ensure they're included in the API call
              extra_filters: [
                ...(subslice.form_data.extra_filters || []),
                ...(formData.extra_filters || []),
              ],
              // Add cross-filters if available
              ...(payload.cross_filters ? { cross_filters: payload.cross_filters } : {}),
              ...(payload.data && payload.data.cross_filters ? { cross_filters: payload.data.cross_filters } : {}),
              // Add dashboard_filters if available
              ...(formData.dashboardFilters ? { dashboard_filters: formData.dashboardFilters } : {}),
              ...(payload.dashboard_filters ? { dashboard_filters: payload.dashboard_filters } : {}),
              ...(payload.data && payload.data.dashboard_filters ? { dashboard_filters: payload.data.dashboard_filters } : {}),
              // Use filtered data from dashboard if available
              ...(hasDashboardData ? { dashboard_data: payload.dashboard_data || payload.data.dashboard_data } : {}),
            },
          };

          const url = getExploreLongUrl(subsliceCopy.form_data, 'json');

          if (url) {
            // First try with all filters
            SupersetClient.get({
              endpoint: url,
            })
              .then(({ json }) => {
                // Process the filtered data response
                if (json) {
                  // Ensure json has a data object even if empty
                  const jsonWithData = json.data ? json : { ...json, data: { features: [] } };
                  
                  // @ts-ignore TODO(hainenber): define proper type for `form_data.viz_type` and call signature for functions in layerGenerators.
                  const layer = layerGenerators[subsliceCopy.form_data.viz_type](
                    subsliceCopy.form_data,
                    jsonWithData,
                    props.onAddFilter,
                    setTooltip,
                    props.datasource,
                    [],
                    props.onSelect,
                  );
                  
                  setSubSlicesLayers(subSlicesLayers => ({
                    ...subSlicesLayers,
                    [subsliceCopy.slice_id]: layer,
                  }));
                }
              })
              .catch((error) => {
                // If request fails, log error and try with a simpler filter setup
                console.error(`Error fetching filtered data for sublayer ${subsliceCopy.slice_id}:`, error);
                
                // Try with basic filters as fallback
                const simpleSubslice = {
                  ...subslice,
                  form_data: {
                    ...subslice.form_data,
                    filters: [...(subslice.form_data.filters || [])], 
                    extra_filters: [...(formData.extra_filters || [])],
                  },
                };
                
                const simpleUrl = getExploreLongUrl(simpleSubslice.form_data, 'json');
                if (simpleUrl) {
                  SupersetClient.get({
                    endpoint: simpleUrl,
                  })
                    .then(({ json }) => {
                      if (json) {
                        // Ensure json has a data object even if empty
                        const jsonWithData = json.data ? json : { ...json, data: { features: [] } };
                        
                        // @ts-ignore 
                        const layer = layerGenerators[simpleSubslice.form_data.viz_type](
                          simpleSubslice.form_data,
                          jsonWithData,
                          props.onAddFilter,
                          setTooltip,
                          props.datasource,
                          [],
                          props.onSelect,
                        );
                      
                      setSubSlicesLayers(subSlicesLayers => ({
                        ...subSlicesLayers,
                        [simpleSubslice.slice_id]: layer,
                      }));
                      }
                    })
                    .catch(() => {
                      console.error(`Failed to load sublayer ${subsliceCopy.slice_id} even with simple filters`);
                    });
                }
              });
          }
        },
      );
    },
    [props.datasource, props.onAddFilter, props.onSelect, setTooltip],
  );

  const prevDeckSlices = usePrevious(props.formData.deck_slices);
  const prevExtraFilters = usePrevious(props.formData.extra_filters);
  // Track all possible filter sources to trigger reloads when they change
  const prevAppliedFilters = usePrevious(
    props.payload.applied_filters || 
    (props.payload.data && props.payload.data.applied_filters)
  );
  
  const prevCrossFilters = usePrevious(
    props.payload.cross_filters || 
    (props.payload.data && props.payload.data.cross_filters)
  );
  
  const prevDashboardFilters = usePrevious(
    props.formData.dashboardFilters ||
    props.payload.dashboard_filters ||
    (props.payload.data && props.payload.data.dashboard_filters)
  );
  
  // Track dashboard data which contains the filtered dataset
  const prevDashboardData = usePrevious(
    props.payload.dashboard_data ||
    (props.payload.data && props.payload.data.dashboard_data)
  );
  
  useEffect(() => {
    const { formData, payload } = props;
    
    // Extract all possible filter sources for comparison
    const currentAppliedFilters = payload.applied_filters || 
                               (payload.data && payload.data.applied_filters);
    const currentCrossFilters = payload.cross_filters || 
                             (payload.data && payload.data.cross_filters);
    const currentDashboardFilters = formData.dashboardFilters ||
                                 payload.dashboard_filters ||
                                 (payload.data && payload.data.dashboard_filters);
                                 
    const currentDashboardData = payload.dashboard_data ||
                             (payload.data && payload.data.dashboard_data);
    
    // Log state changes that might trigger reload
    console.group('Multi chart - checking for changes that require reload');
    console.log('Current deck_slices:', formData.deck_slices);
    console.log('Previous deck_slices:', prevDeckSlices);
    console.log('Current extra_filters:', formData.extra_filters);
    console.log('Previous extra_filters:', prevExtraFilters);
    console.log('Current applied_filters:', currentAppliedFilters);
    console.log('Previous applied_filters:', prevAppliedFilters);
    console.log('Current cross_filters:', currentCrossFilters);
    console.log('Previous cross_filters:', prevCrossFilters);
    console.log('Current dashboard_filters:', currentDashboardFilters);
    console.log('Previous dashboard_filters:', prevDashboardFilters);
    console.log('Current dashboard_data:', currentDashboardData);
    console.log('Previous dashboard_data:', prevDashboardData);
                               
    const hasChanges = !isEqual(prevDeckSlices, formData.deck_slices) || 
                      !isEqual(prevExtraFilters, formData.extra_filters) ||
                      !isEqual(prevAppliedFilters, currentAppliedFilters) ||
                      !isEqual(prevCrossFilters, currentCrossFilters) ||
                      !isEqual(prevDashboardFilters, currentDashboardFilters) ||
                      !isEqual(prevDashboardData, currentDashboardData);
    
    console.log('Detected changes requiring reload:', hasChanges);
    console.groupEnd();
    if (hasChanges) {
      loadLayers(formData, payload);
    }
  }, [loadLayers, prevDeckSlices, prevExtraFilters, prevAppliedFilters, prevCrossFilters, prevDashboardFilters, prevDashboardData, props]);

  const { payload, formData, setControlValue, height, width } = props;
  const layers = Object.values(subSlicesLayers);

  return (
    <DeckGLContainerStyledWrapper
      ref={containerRef}
      mapboxApiAccessToken={payload.data.mapboxApiKey}
      viewport={viewport || props.viewport}
      layers={layers}
      mapStyle={formData.mapbox_style}
      setControlValue={setControlValue}
      onViewportChange={setViewport}
      height={height}
      width={width}
    />
  );
};

export default memo(DeckMulti);
